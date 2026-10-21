import { Timestamp } from 'firebase-admin/firestore'

// Push notifications through Expo's push service, which delivers to both
// Apple and Google from one API. Pushes wait in pushQueue (server-only) and
// are sent in batches: right after the change that caused them where
// possible, and by the daily job for anything left over.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const MAX_ATTEMPTS = 3
const CHUNK = 100

const isExpoToken = (t) => typeof t === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(t)

// With `ids`, sends just those (what a request has just queued); without,
// whatever is pending (the daily job).
export async function drainPushQueue(db, { ids, limit = 300, now = new Date(), fetchImpl = globalThis.fetch } = {}) {
  const pending = ids
    ? { docs: (ids.length ? await db.getAll(...ids.map(id => db.doc(`pushQueue/${id}`))) : []).filter(d => d.exists && d.data().status === 'pending') }
    : await db.collection('pushQueue').where('status', '==', 'pending').limit(limit).get()
  if (!pending.docs.length) return { sent: 0, failed: 0, noDevice: 0 }

  // Every device for everyone with something waiting.
  const uids = [...new Set(pending.docs.map(d => d.data().uid))]
  const devices = new Map()
  await Promise.all(uids.map(async uid => {
    const snap = await db.collection(`users/${uid}/devices`).get()
    devices.set(uid, snap.docs.filter(d => isExpoToken(d.data().token)).map(d => ({ ref: d.ref, token: d.data().token })))
  }))

  const messages = []
  const outcome = new Map()
  for (const item of pending.docs) {
    const p = item.data()
    const targets = devices.get(p.uid) || []
    if (!targets.length) { outcome.set(item.id, 'no_device'); continue }
    for (const t of targets) {
      messages.push({ item, device: t, body: { to: t.token, title: p.title, body: p.body, data: { link: p.link }, sound: 'default' } })
    }
  }

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
  const staleDevices = new Set()
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK)
    let tickets = []
    try {
      const resp = await fetchImpl(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(chunk.map(m => m.body)) })
      tickets = (await resp.json())?.data || []
    } catch (err) {
      console.error('push send failed:', err.message)
    }
    chunk.forEach((m, j) => {
      const ticket = tickets[j]
      if (ticket?.status === 'ok') outcome.set(m.item.id, 'sent')
      else {
        // A device the app was uninstalled from: forget it.
        if (ticket?.details?.error === 'DeviceNotRegistered') staleDevices.add(m.device.ref)
        if (outcome.get(m.item.id) !== 'sent') outcome.set(m.item.id, 'failed')
      }
    })
  }

  const at = Timestamp.fromDate(now)
  const batch = db.batch()
  let sent = 0, failed = 0, noDevice = 0
  for (const item of pending.docs) {
    const result = outcome.get(item.id)
    const attempts = (item.data().attempts || 0) + 1
    if (result === 'sent') { sent++; batch.update(item.ref, { status: 'sent', sentAt: at, attempts }) }
    else if (result === 'no_device') { noDevice++; batch.update(item.ref, { status: 'no_device', attempts }) }
    else { failed++; batch.update(item.ref, { status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts }) }
  }
  staleDevices.forEach(ref => batch.delete(ref))
  await batch.commit()
  return { sent, failed, noDevice }
}
