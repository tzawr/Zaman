import { Timestamp } from 'firebase-admin/firestore'
import { paths } from '../shared/teams/schema.js'
import { messages } from '../shared/teams/notifications.js'

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

export async function deliver(db, intents, now = new Date()) {
  if (!intents?.length) return { written: 0, queued: [] }
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
    const message = build({ bizId: intent.bizId, businessName: await businessName(intent.bizId), ...intent.params })
    for (const uid of await recipients(db, intent.bizId, intent.to, intent.exclude || [])) {
      out.set(`${uid}|${message.key}`, { uid, message, bizId: intent.bizId })
    }
  }
  if (!out.size) return { written: 0, queued: [] }

  // A push already queued for this key is left alone, so a retry does not
  // buzz anyone's phone twice.
  const entries = [...out.values()]
  const queueRefs = entries.map(e => db.doc(`pushQueue/${e.uid}_${e.message.key}`))
  const existing = await db.getAll(...queueRefs)
  const at = Timestamp.fromDate(now)
  let batch = db.batch()
  let ops = 0
  for (const [i, e] of entries.entries()) {
    const { key, ...content } = e.message
    const first = !existing[i].exists
    // readAt is set only when the notification is new, so a retry does not
    // mark a read notification unread again.
    batch.set(db.doc(paths.notification(e.uid, key)), {
      ...content, bizId: e.bizId, createdAt: at, ...(first ? { readAt: null } : {}),
    }, { merge: true })
    if (first) {
      batch.set(queueRefs[i], {
        uid: e.uid, title: content.title, body: content.body, link: content.link,
        status: 'pending', attempts: 0, createdAt: at,
      })
    }
    ops += 2
    if (ops >= 400) {
      await batch.commit()
      batch = db.batch()
      ops = 0
    }
  }
  if (ops) await batch.commit()
  return { written: entries.length, queued: queueRefs.filter((_, i) => !existing[i].exists).map(r => r.id) }
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
