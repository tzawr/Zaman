import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin, requireSignedIn, sendError } from '../_firebase-admin.js'
import { consumeRateLimit, sendRateLimited } from '../_rate-limit.js'
import { TeamsError, applyCors, clientIp, readBody } from '../_teams-http.js'
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
    const result = await action.run({
      db: getFirestore(),
      uid: token?.uid || null,
      token,
      input: readBody(req),
      now: new Date(),
    })
    return res.status(200).json(result)
  } catch (err) {
    if (err instanceof TeamsError) {
      return res.status(err.status).json({ blocked: true, reason: err.reason, message: err.message })
    }
    return sendError(res, err)
  }
}
