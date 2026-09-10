import { getFirestore } from 'firebase-admin/firestore'
import { adminAuth, initAdmin, requireSignedIn, sendError } from './_firebase-admin.js'
import { consumeRateLimit, sendRateLimited } from './_rate-limit.js'

// Erasing an account is done here rather than in the browser for two reasons.
// A client loop that deletes a hundred documents and then loses its connection
// leaves an account half-erased with no record of how far it got. And the last
// step — removing the auth user itself — is not something a client can be
// trusted to reach, which would leave a sign-in with no data behind it.
//
// Everything the account owns, by collection and the field that owns it:
const OWNED_BY_USER_ID = ['employees', 'schedules']
const OWNED_BY_MANAGER_ID = ['invites']
// Keyed by uid rather than holding it in a field.
const KEYED_BY_UID = ['users', 'adminOverrides']

// Firestore caps a batch at 500 writes.
const BATCH_SIZE = 400

async function deleteQueryInBatches(db, query) {
  let deleted = 0
  for (;;) {
    const snap = await query.limit(BATCH_SIZE).get()
    if (snap.empty) return deleted
    const batch = db.batch()
    snap.docs.forEach(doc => batch.delete(doc.ref))
    await batch.commit()
    deleted += snap.size
    if (snap.size < BATCH_SIZE) return deleted
  }
}

// aiUsage and rateLimits documents are keyed `<uid>_<period>`, but both also
// carry the owner in a field, so they are found by field rather than by
// picking apart document ids.
const OWNER_FIELD = { aiUsage: 'uid', rateLimits: 'key' }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let decoded
  try {
    initAdmin()
    decoded = await requireSignedIn(req)
  } catch (err) {
    return sendError(res, err, 'Sign in to delete your account.')
  }

  const uid = decoded.uid

  // Deleting an account is irreversible, so the browser re-authenticates first
  // and this checks that it actually happened. auth_time is when the user last
  // proved who they are; a token minted from a session that has been sitting
  // open for a week is not consent to erase it.
  const authAgeSeconds = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0)
  if (!Number.isFinite(authAgeSeconds) || authAgeSeconds > 5 * 60) {
    return res.status(401).json({
      blocked: true,
      reason: 'reauth_required',
      message: 'Confirm your password to delete your account.',
    })
  }

  const limit = await consumeRateLimit('delete-account', uid, 5, 60 * 60)
  if (!limit.allowed) {
    return sendRateLimited(res, limit.retryAfterSeconds, 'Too many attempts. Try again in a little while.')
  }

  try {
    const db = getFirestore()
    const removed = {}

    for (const collection of OWNED_BY_USER_ID) {
      removed[collection] = await deleteQueryInBatches(
        db, db.collection(collection).where('userId', '==', uid))
    }
    for (const collection of OWNED_BY_MANAGER_ID) {
      removed[collection] = await deleteQueryInBatches(
        db, db.collection(collection).where('managerId', '==', uid))
    }
    for (const [collection, field] of Object.entries(OWNER_FIELD)) {
      removed[collection] = await deleteQueryInBatches(
        db, db.collection(collection).where(field, '==', uid))
    }
    for (const collection of KEYED_BY_UID) {
      await db.collection(collection).doc(uid).delete()
    }

    // Last, so a failure anywhere above leaves an account that can still sign
    // in and retry rather than a dangling sign-in with no data.
    await adminAuth().deleteUser(uid)

    console.log('account deleted', uid, JSON.stringify(removed))
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Account deletion failed:', uid, err)
    return res.status(500).json({
      blocked: true,
      reason: 'server_error',
      message: 'We could not finish deleting your account. Nothing was lost — email us and we will do it by hand.',
    })
  }
}
