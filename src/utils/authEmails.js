import { sendEmailVerification, sendPasswordResetEmail } from 'firebase/auth'
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
