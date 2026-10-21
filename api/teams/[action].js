import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin, requireSignedIn, sendError } from '../_firebase-admin.js'
import { consumeRateLimit, sendRateLimited } from '../_rate-limit.js'
import { TeamsError, applyCors, clientIp, readBody } from '../_teams-http.js'
import * as availability from '../_teams-availability.js'
import * as hengam from '../_teams-hengam.js'
import * as imports from '../_teams-imports.js'
import { calendarFeed } from '../_teams-calendar.js'
import { deliver, markAllRead } from '../_teams-notify.js'
import { drainPushQueue } from '../_teams-push.js'
import * as marketplace from '../_teams-marketplace.js'
import * as schedules from '../_teams-schedules.js'
import * as workspaces from '../_teams-workspaces.js'

// Every Teams workflow behind one function. Vercel's Hobby plan caps a project
// at twelve functions, and Teams will need dozens of actions.
//
// POST /api/teams/<action> with a JSON body. Each action declares whether it
// needs a signed-in caller and how hard it may be hit; the workflow itself
// does the authorization against what it reads inside its transaction.
const ACTIONS = {
  createBusiness: { run: workspaces.createBusiness, limit: [10, 60 * 60] },
  createInvite: { run: workspaces.createInvite, limit: [60, 60 * 60] },
  revokeInvite: { run: workspaces.revokeInvite, limit: [60, 60 * 60] },
  // Called before sign-in, so it is limited by address. The limit is what
  // keeps invite codes out of reach of guessing.
  previewInvite: { run: workspaces.previewInvite, auth: false, limit: [30, 15 * 60] },
  acceptInvite: { run: workspaces.acceptInvite, limit: [20, 15 * 60] },
  updateMemberRole: { run: workspaces.updateMemberRole, limit: [60, 60 * 60] },
  removeMember: { run: workspaces.removeMember, limit: [60, 60 * 60] },
  leaveBusiness: { run: workspaces.leaveBusiness, limit: [20, 60 * 60] },
  // Building a week is many small saves, so these allow a steady pace.
  saveShift: { run: schedules.saveShift, limit: [600, 60 * 60] },
  deleteShift: { run: schedules.deleteShift, limit: [600, 60 * 60] },
  publishSchedule: { run: schedules.publishSchedule, limit: [60, 60 * 60] },
  offerShift: { run: marketplace.offerShift, limit: [60, 60 * 60] },
  cancelOffer: { run: marketplace.cancelOffer, limit: [120, 60 * 60] },
  previewClaim: { run: marketplace.previewClaim, limit: [600, 60 * 60] },
  claimOffer: { run: marketplace.claimOffer, limit: [60, 60 * 60] },
  withdrawClaim: { run: marketplace.withdrawClaim, limit: [120, 60 * 60] },
  decideClaim: { run: marketplace.decideClaim, limit: [300, 60 * 60] },
  listSwapCandidates: { run: marketplace.listSwapCandidates, limit: [300, 60 * 60] },
  requestSwap: { run: marketplace.requestSwap, limit: [60, 60 * 60] },
  respondSwap: { run: marketplace.respondSwap, limit: [120, 60 * 60] },
  decideSwap: { run: marketplace.decideSwap, limit: [300, 60 * 60] },
  cancelSwap: { run: marketplace.cancelSwap, limit: [120, 60 * 60] },
  saveAvailability: { run: availability.saveAvailability, limit: [120, 60 * 60] },
  addAvailabilityOverride: { run: availability.addAvailabilityOverride, limit: [120, 60 * 60] },
  removeAvailabilityOverride: { run: availability.removeAvailabilityOverride, limit: [120, 60 * 60] },
  requestTimeOff: { run: availability.requestTimeOff, limit: [60, 60 * 60] },
  cancelTimeOff: { run: availability.cancelTimeOff, limit: [120, 60 * 60] },
  decideTimeOff: { run: availability.decideTimeOff, limit: [300, 60 * 60] },
  updatePolicies: { run: availability.updatePolicies, limit: [120, 60 * 60] },
  hengamConnect: { run: hengam.hengamConnect, limit: [10, 60 * 60] },
  hengamPublish: { run: hengam.hengamPublish, limit: [120, 60 * 60] },
  markAllNotificationsRead: { run: markAllRead, limit: [120, 60 * 60] },
  calendarFeed: { run: calendarFeed, limit: [30, 60 * 60] },
  // Reading a file can call Claude, which costs money; the per-business
  // monthly budget in _teams-extract.js is the real cap.
  importSchedule: { run: imports.importSchedule, limit: [30, 60 * 60] },
  applyImport: { run: imports.applyImport, limit: [60, 60 * 60] },
  discardImport: { run: imports.discardImport, limit: [60, 60 * 60] },
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const name = req.query?.action
  const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null
  if (!action) return res.status(404).json({ blocked: true, reason: 'not_found', message: 'Unknown action.' })

  let token = null
  try {
    initAdmin()
    if (action.auth !== false) token = await requireSignedIn(req)
  } catch (err) {
    return sendError(res, err, 'Sign in to continue.')
  }

  const [max, windowSeconds] = action.limit
  const limit = await consumeRateLimit(`teams-${name}`, token?.uid || clientIp(req), max, windowSeconds)
  if (!limit.allowed) {
    return sendRateLimited(res, limit.retryAfterSeconds, 'Too many attempts. Try again in a little while.')
  }

  try {
    const db = getFirestore()
    const { notify, ...result } = await action.run({
      db,
      uid: token?.uid || null,
      token,
      input: readBody(req),
      now: new Date(),
    })
    // The change is committed; telling people about it must not turn a
    // success into an error. A failure here is logged and the notifications
    // are simply missing, never duplicated.
    if (notify?.length) {
      await deliver(db, notify)
        // Send the pushes this change queued now, rather than at the next
        // daily run. Anything that fails waits in the queue for that run.
        .then(({ queued }) => drainPushQueue(db, { ids: queued }))
        .catch(err => console.error('notification delivery failed:', err))
    }
    return res.status(200).json(result)
  } catch (err) {
    if (err instanceof TeamsError) {
      return res.status(err.status).json({ blocked: true, reason: err.reason, message: err.message, problems: err.problems || undefined })
    }
    return sendError(res, err)
  }
}
