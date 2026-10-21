import { getFirestore } from 'firebase-admin/firestore'
import { deleteAccount } from './_account-deletion.js'
import { initAdmin, requireSignedIn, sendError } from './_firebase-admin.js'
import { consumeRateLimit, sendRateLimited } from './_rate-limit.js'
import { TeamsError } from './_teams-http.js'

// Hengam's "Delete account". The work, and why it is done on the server, is
// in _account-deletion.js; Hengam Teams reaches the same code through its
// deleteAccount action.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let decoded
  try {
    initAdmin()
    decoded = await requireSignedIn(req)
  } catch (err) {
    return sendError(res, err, 'Sign in to delete your account.')
  }

  const limit = await consumeRateLimit('delete-account', decoded.uid, 5, 60 * 60)
  if (!limit.allowed) {
    return sendRateLimited(res, limit.retryAfterSeconds, 'Too many attempts. Try again in a little while.')
  }

  try {
    const result = await deleteAccount({ db: getFirestore(), uid: decoded.uid, token: decoded, now: new Date() })
    return res.status(200).json(result)
  } catch (err) {
    if (err instanceof TeamsError) {
      return res.status(err.status).json({ blocked: true, reason: err.reason, message: err.message })
    }
    return sendError(res, err)
  }
}
