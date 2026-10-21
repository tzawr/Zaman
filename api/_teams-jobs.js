import { Timestamp } from 'firebase-admin/firestore'
import { paths } from '../shared/teams/schema.js'
import { todayIn } from '../shared/teams/time.js'
import { deliver } from './_teams-notify.js'
import { drainPushQueue } from './_teams-push.js'
import { recordError, summariseAndPruneErrors } from './_monitoring.js'

// The daily job: remind people of tomorrow's shifts, close offers and swaps
// whose deadline passed, and send any pushes still waiting. Every part is
// safe to run twice: reminders are keyed by shift version, and closing
// checks the status again inside a transaction.

const HOUR = 60 * 60 * 1000

export async function sendReminders(db, now = new Date()) {
  // From now until the end of tomorrow, wherever the business is.
  const snap = await db.collectionGroup('shifts')
    .where('published', '==', true)
    .where('startAt', '>=', Timestamp.fromDate(now))
    .where('startAt', '<', Timestamp.fromMillis(now.getTime() + 36 * HOUR))
    .get()
  const zones = new Map()
  const intents = []
  for (const d of snap.docs) {
    const shift = { id: d.id, ...d.data() }
    if (shift.status === 'cancelled' || !shift.assigneeUid) continue
    const bizId = d.ref.parent.parent.id
    if (!zones.has(bizId)) zones.set(bizId, (await db.doc(paths.business(bizId)).get()).data()?.timezone || 'UTC')
    intents.push({ kind: 'shiftReminder', bizId, to: shift.assigneeUid, params: { shift, today: todayIn(zones.get(bizId), now) } })
  }
  const { written } = await deliver(db, intents, now)
  return { reminders: written }
}

async function expire(db, group, openStatuses, now, release) {
  const snap = await db.collectionGroup(group)
    .where('status', 'in', openStatuses)
    .where('expiresAt', '<', Timestamp.fromDate(now))
    .limit(300)
    .get()
  let closed = 0
  for (const d of snap.docs) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref)
      if (!openStatuses.includes(fresh.data()?.status)) return
      const bizId = d.ref.parent.parent.id
      const shiftRefs = release(fresh.data()).map(id => db.doc(paths.shift(bizId, id)))
      const shifts = await Promise.all(shiftRefs.map(r => tx.get(r)))
      tx.update(d.ref, { status: 'expired', claimantUids: [], updatedAt: Timestamp.fromDate(now) })
      shifts.forEach(s => {
        if (!s.exists) return
        const lock = group === 'offers' ? 'openOfferId' : 'swapId'
        if (s.data()[lock] === d.id) tx.update(s.ref, { [lock]: null })
      })
      closed++
    })
  }
  return closed
}

export async function expireRequests(db, now = new Date()) {
  const offers = await expire(db, 'offers', ['available', 'pending'], now, o => [o.shiftId])
  const swaps = await expire(db, 'swaps', ['pending_peer', 'pending_manager'], now, s => [s.shiftA.id, s.shiftB.id])
  return { offersExpired: offers, swapsExpired: swaps }
}

// Each part runs even when one before it fails; a failure is recorded and
// reported in the result rather than skipping the rest of the day's work.
export async function runDailyJob(db, now = new Date(), options = {}) {
  const parts = {
    reminders: () => sendReminders(db, now),
    expiry: () => expireRequests(db, now),
    push: () => drainPushQueue(db, { now, ...options }),
    errors: () => summariseAndPruneErrors(db, now),
  }
  const result = {}
  const failed = []
  for (const [part, run] of Object.entries(parts)) {
    try {
      Object.assign(result, await run())
    } catch (err) {
      console.error(`daily job: ${part} failed:`, err)
      failed.push(part)
      await recordError(db, { source: 'cron', where: part, error: err, now })
    }
  }
  return failed.length ? { ...result, failed } : result
}
