import { createHmac, timingSafeEqual } from 'node:crypto'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { initAdmin } from '../_firebase-admin.js'
import { recordError } from '../_monitoring.js'
import { RETENTION, sha } from '../_notify.js'

// Resend delivery events (sent through Svix). Signed with RESEND_WEBHOOK_SECRET
// ("whsec_..."); anything unsigned, stale or forged is refused before it is
// read. Bounces and complaints add the address to a suppression list (stored
// as a hash), so we stop writing to it.

const TOLERANCE_S = 5 * 60
const MAX_BODY = 256 * 1024

export function verifySvix({ secret, id, timestamp, signature, body, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signature) return false
  const t = Number(timestamp)
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > TOLERANCE_S) return false
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return String(signature).split(' ').some(part => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) return false
    const given = Buffer.from(sig, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const STATUS = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
}

/** Applies one verified event. Exported for tests. */
export async function applyEvent(db, event, now = new Date()) {
  const status = STATUS[event?.type]
  if (!status) return { ignored: true }
  const providerId = String(event.data?.email_id || '').slice(0, 100)
  const to = [].concat(event.data?.to || [])
  const at = Timestamp.fromDate(now)
  const batch = db.batch()
  // Idempotent: one row per provider event id.
  batch.set(db.doc(`emailEvents/${sha(`${providerId}|${event.type}`).slice(0, 40)}`), {
    providerId, status, at, expireAt: Timestamp.fromDate(new Date(+now + RETENTION.log)),
  })
  if (status === 'bounced' || status === 'complained') {
    // A hard bounce or a spam complaint: stop sending to this address.
    const permanent = status === 'complained' || event.data?.bounce?.type !== 'Transient'
    if (permanent) for (const addr of to) batch.set(db.doc(`emailSuppressions/${sha(addr)}`), { reason: status, at }, { merge: true })
  }
  await batch.commit()
  return { status }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return res.status(503).json({ error: 'Webhook not configured' })
  let body
  try { body = await rawBody(req) } catch (err) { return res.status(err.status || 400).json({ error: 'Bad request' }) }
  const ok = verifySvix({
    secret, body,
    id: req.headers['svix-id'], timestamp: req.headers['svix-timestamp'], signature: req.headers['svix-signature'],
  })
  if (!ok) return res.status(401).json({ error: 'Invalid signature' })
  let event
  try { event = JSON.parse(body) } catch { return res.status(400).json({ error: 'Bad request' }) }
  try {
    initAdmin()
    const result = await applyEvent(getFirestore(), event)
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    await recordError(getFirestore(), { source: 'server', where: 'email.webhook', error: err }).catch(() => {})
    // 500 makes Resend retry later.
    return res.status(500).json({ error: 'Try again' })
  }
}
