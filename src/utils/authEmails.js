import { sendEmailVerification, sendPasswordResetEmail, verifyBeforeUpdateEmail } from 'firebase/auth'
import { auth } from '../firebase'

// HENGAM-branded verification and reset emails (sent by our server through
// Resend), with Firebase's own email as the fallback whenever ours cannot go
// out. Either way the person gets a working link.

async function post(action, body, token) {
  const resp = await fetch(`/api/teams/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const data = await resp.json().catch(() => ({}))
  return { status: resp.status, data }
}

/** Sends the signed-in user a verification email. Resolves when one is on its way. */
export async function requestVerificationEmail(user, language = 'en') {
  try {
    const token = await user.getIdToken()
    const { status, data } = await post('sendVerificationEmail', { language }, token)
    if (status === 200 && (data.sent || data.reason === 'already_verified')) return { via: 'hengam' }
    if (status === 429) throw Object.assign(new Error('rate limited'), { code: 'auth/too-many-requests' })
  } catch (err) {
    if (err?.code === 'auth/too-many-requests') throw err
  }
  await sendEmailVerification(user)
  return { via: 'firebase' }
}

/** Sends a password reset email if the address has an account (never says which). */
export async function requestPasswordReset(email, language = 'en') {
  try {
    const { status, data } = await post('sendPasswordReset', { email, language })
    if (status === 200 && !data.fallback) return { via: 'hengam' }
    if (status === 429) throw Object.assign(new Error('rate limited'), { code: 'auth/too-many-requests' })
  } catch (err) {
    if (err?.code === 'auth/too-many-requests') throw err
  }
  await sendPasswordResetEmail(auth, email)
  return { via: 'firebase' }
}

const authError = (code) => Object.assign(new Error(code), { code })

/**
 * Starts changing the signed-in user's sign-in email: a confirmation link goes
 * to the new address. Needs a recent sign-in, like Firebase's own email change
 * (errors use Firebase's codes, so callers handle both paths the same way).
 */
export async function requestEmailChange(user, newEmail, language = 'en') {
  try {
    const token = await user.getIdToken(true)
    const { status, data } = await post('requestEmailChange', { newEmail, language }, token)
    if (status === 429 || data.reason === 'rate_limited') throw authError('auth/too-many-requests')
    if (data.reason === 'requires_recent_login') throw authError('auth/requires-recent-login')
    if (data.reason === 'invalid_email') throw authError('auth/invalid-email')
    if (data.reason === 'same_email') throw authError('hengam/same-email')
    // A Google-only account's email belongs to Google; Firebase's own email
    // change would not be right either, so there is no fallback for this.
    if (data.reason === 'managed_by_google') throw authError('hengam/email-managed-by-google')
    if (data.reason === 'no_email_sign_in') throw authError('hengam/no-email-sign-in')
    if (status === 200 && data.sent) return { via: 'hengam' }
  } catch (err) {
    if (/^(auth|hengam)\//.test(String(err?.code))) throw err
  }
  await verifyBeforeUpdateEmail(user, newEmail)
  return { via: 'firebase' }
}
