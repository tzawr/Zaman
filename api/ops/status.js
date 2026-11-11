import { timingSafeEqual } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin } from '../_firebase-admin.js'
import { evaluate, gather, thresholdsFrom } from '../_ops-status.js'

// GET /api/ops/status — for an uptime monitor with alerting (Google Cloud
// Monitoring uptime check, or any monitor that can send a header):
//   Authorization: Bearer <OPS_STATUS_TOKEN>
// Answers 200 when everything is ok or only warnings, 503 when anything is
// critical, so a plain status-code check alerts on critical and a keyword
// check on `"level":"ok"` alerts on warnings too. Counts only, no user data.
// Without OPS_STATUS_TOKEN configured the endpoint does not exist (404).

function authorised(req) {
  const expected = Buffer.from(process.env.OPS_STATUS_TOKEN || '')
  const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''))
  // Byte lengths, not character lengths: timingSafeEqual throws on unequal
  // buffers, and a multi-byte character would otherwise turn a 401 into a 500.
  if (expected.length < 24 || given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

export default async function handler(req, res) {
  if (!process.env.OPS_STATUS_TOKEN) return res.status(404).json({ error: 'Not found' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorized' })
  res.setHeader('Cache-Control', 'no-store')
  try {
    initAdmin()
    const now = new Date()
    const { level, checks } = evaluate(await gather(getFirestore(), now), thresholdsFrom())
    return res.status(level === 'critical' ? 503 : 200).json({
      level,
      checks,
      version: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
      at: now.toISOString(),
    })
  } catch (err) {
    console.error('ops status failed:', err?.message || err)
    return res.status(503).json({ level: 'critical', checks: [{ name: 'status', level: 'critical', detail: 'status check failed' }] })
  }
}
