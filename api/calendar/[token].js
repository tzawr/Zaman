import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin } from '../_firebase-admin.js'
import { consumeRateLimit } from '../_rate-limit.js'
import { renderFeed } from '../_teams-calendar.js'

// GET /api/calendar/<token>.ics: a person's shifts as an iCalendar feed.
// Calendar apps poll this without signing in, so the token in the path is
// the credential. Unknown tokens get the same 404 as malformed ones.
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end()
  const token = String(req.query?.token || '').replace(/\.ics$/, '')
  try {
    initAdmin()
    const limit = await consumeRateLimit('calendar-feed', token.slice(0, 48) || 'none', 120, 60 * 60)
    if (!limit.allowed) return res.status(429).end()
    const ics = await renderFeed(getFirestore(), token)
    if (!ics) return res.status(404).send('Not found')
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', 'inline; filename="shifts.ics"')
    // The feed is personal: no shared caches.
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    return res.status(200).send(ics)
  } catch (err) {
    console.error('calendar feed failed:', err)
    return res.status(500).send('Unavailable')
  }
}
