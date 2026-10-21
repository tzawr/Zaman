import { Timestamp } from 'firebase-admin/firestore'
import { paths } from '../shared/teams/schema.js'
import { todayIn } from '../shared/teams/time.js'
import { deliver } from './_teams-notify.js'
import { drainPushQueue } from './_teams-push.js'

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

export async function runDailyJob(db, now = new Date(), options = {}) {
  const reminders = await sendReminders(db, now)
  const expired = await expireRequests(db, now)
  const pushes = await drainPushQueue(db, { now, ...options })
  return { ...reminders, ...expired, ...pushes }
}
