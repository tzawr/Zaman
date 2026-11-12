import { Timestamp } from 'firebase-admin/firestore'
import { paths } from '../shared/teams/schema.js'
import { messages } from '../shared/teams/notifications.js'
import { persistNotifications } from './_notify.js'

// Notifications are side effects of a committed change, so they are written
// after it, from what the successful transaction attempt returned. A
// workflow returns `notify`: a list of intents like
//   { kind: 'shiftOffered', bizId, to: 'members', exclude: [uid], params }
// where `to` is a uid, 'managers', or 'members'.
//
// Each notification's document id is its message key, so delivering the
// same intent twice writes one notification and queues one push.

const MAX_RECIPIENTS = 200

async function recipients(db, bizId, to, exclude) {
  if (to !== 'managers' && to !== 'members') return exclude.includes(to) ? [] : [to]
  let q = db.collection(`businesses/${bizId}/members`).where('status', '==', 'active')
  if (to === 'managers') q = q.where('role', 'in', ['owner', 'manager'])
  const snap = await q.limit(MAX_RECIPIENTS).get()
  return snap.docs.map(d => d.id).filter(uid => !exclude.includes(uid))
}

// The small, safe facts stored with each notification so the web app and
// emails can say it in English or Persian (shared/notify/text.js).
function factsFor(kind, p, biz) {
  const s = p.shift || p.give || null
  const shift = s ? { date: s.date, start: s.startLocal, end: s.endLocal, cancelled: s.status === 'cancelled' } : {}
  switch (kind) {
    case 'schedulePublished': return { biz, weekStart: p.weekStart, count: p.shiftCount }
    case 'scheduleChanged': return { biz, weekStart: p.weekStart }
    case 'shiftChanged': case 'shiftReminder': return { biz, ...shift }
    case 'shiftOffered': return { biz, who: p.offeredByName, ...shift }
    case 'pickupRequested': return { biz, who: p.claimantName, ...shift }
    case 'pickupDecided': return { biz, approved: !!p.approved, ...shift }
    case 'swapRequested': case 'swapNeedsApproval': return { biz, who: p.requesterName }
    case 'swapDecided': return { biz, approved: p.status === 'completed' }
    case 'timeOffRequested': return { biz, who: p.request?.staffName, date: p.request?.startDate }
    case 'timeOffDecided': return { biz, approved: !!p.approved, date: p.request?.startDate }
    default: return { biz }
  }
}

export async function deliver(db, intents, now = new Date()) {
  if (!intents?.length) return { written: 0, queued: [], emails: [] }
  const names = new Map()
  const businessName = async (bizId) => {
    if (!names.has(bizId)) {
      const snap = await db.doc(paths.business(bizId)).get()
      names.set(bizId, snap.data()?.name || 'Your workplace')
    }
    return names.get(bizId)
  }

  // Resolve every intent to (recipient, message) pairs, one per key.
  const out = new Map()
  for (const intent of intents) {
    const build = messages[intent.kind]
    if (!build) continue
    const biz = await businessName(intent.bizId)
    const message = build({ bizId: intent.bizId, businessName: biz, ...intent.params })
    const facts = factsFor(intent.kind, intent.params || {}, biz)
    for (const uid of await recipients(db, intent.bizId, intent.to, intent.exclude || [])) {
      out.set(`${uid}|${message.key}`, { uid, key: message.key, type: message.type, title: message.title, body: message.body, link: message.link, app: 'teams', facts, bizId: intent.bizId })
    }
  }
  // In-app, push and email, each by the person's preferences, each once.
  return persistNotifications(db, [...out.values()], now)
}

// Marks every notification read for one person, from the server, so the app
// does not have to write them one at a time.
export async function markAllRead({ db, uid, now }) {
  const snap = await db.collection(`users/${uid}/notifications`).where('readAt', '==', null).limit(400).get()
  const unread = snap.docs
  const batch = db.batch()
  unread.forEach(d => batch.update(d.ref, { readAt: Timestamp.fromDate(now) }))
  if (unread.length) await batch.commit()
  return { marked: unread.length }
}
