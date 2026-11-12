// Tells the server about a failure a person ran into, so operations can see
// it (errorEvents, /api/ops/status). Sends a fixed location label and an error
// code or short message only: never names, emails, schedule contents or the
// manager's written rules. Fire-and-forget, a few per page load at most, and
// it never throws.

const MAX_PER_SESSION = 5
let sent = 0

/**
 * @param {string} where  fixed label, e.g. 'schedule.generate', 'auth.signin'
 * @param {unknown} error an Error, a Firebase error, or a short code string
 */
export function reportError(where, error) {
  try {
    if (sent >= MAX_PER_SESSION || typeof fetch !== 'function') return
    sent++
    const code = typeof error === 'string' ? error : (error?.code || error?.name || 'Error')
    // Firebase messages can echo an email address; send the code alone for those.
    const message = typeof error === 'string' || error?.code ? code : String(error?.message || code).slice(0, 200)
    fetch('/api/teams/reportClientError', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, route: where, platform: 'web', appVersion: 'hengam-web' }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Reporting must never become a second failure.
  }
}

// Kept here for existing imports; the list lives with the auth messages.
export { EXPECTED_AUTH_ERRORS } from './authErrors.js'
