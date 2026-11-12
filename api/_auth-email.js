import { adminAuth } from './_firebase-admin.js'
import { appOrigin, authActionEmail, emailEnabled, securityFrom, sendEmail, validEmail } from './_email.js'
import { consumeRateLimit } from './_rate-limit.js'
import { recordError } from './_monitoring.js'
import { sha } from './_notify.js'

// HENGAM-branded verification and password-reset emails.
//
// Firebase makes the one-time link (Admin SDK); we keep only its mode and
// oobCode and point it at our own page, https://hengam.app/auth/action, which
// completes the action with Firebase's client SDK. The email goes out through
// Resend from security@mail.hengam.app in the person's language.
//
// If our email cannot go out (email off, provider down), the action answers
// { fallback: true } and the app asks Firebase to send its own email, so
// signing up and resetting a password never depend on us alone.

const lang = (v) => (v === 'fa' ? 'fa' : 'en')

/** Our link for a Firebase action link: same one-time code, HENGAM's page. */
export function hengamActionLink(firebaseLink, { language = 'en', continuePath = '/dashboard', env = process.env } = {}) {
  const u = new URL(firebaseLink)
  const mode = u.searchParams.get('mode')
  const oobCode = u.searchParams.get('oobCode')
  if (!mode || !oobCode) throw new Error('auth link without mode or code')
  const out = new URL('/auth/action', appOrigin(env))
  out.searchParams.set('mode', mode)
  out.searchParams.set('oobCode', oobCode)
  out.searchParams.set('lang', lang(language))
  if (continuePath && continuePath.startsWith('/') && !continuePath.startsWith('//')) out.searchParams.set('continue', continuePath)
  return out.toString()
}

async function deliver(db, { to, kind, link, language, env, send, now }) {
  const message = authActionEmail({ kind, link, language: lang(language), origin: appOrigin(env) })
  try {
    const r = await send({ to, ...message, tag: `auth_${kind}`, from: securityFrom(env) }, { env })
    if (r?.sent === false) return { sent: false, fallback: true }
    await db.collection('emailLog').add({ type: `auth_${kind}`, category: 'security', uidHash: sha(to).slice(0, 16), status: 'sent', providerId: r?.id || null, at: now, expireAt: new Date(+now + 180 * 864e5) })
    return { sent: true }
  } catch (err) {
    await recordError(db, { source: 'server', where: `auth.${kind}`, error: err, now }).catch(() => {})
    return { sent: false, fallback: true }
  }
}

/** Signed in: send a verification email to the account's own address. */
export async function sendVerificationEmail({ db, token, input = {}, now, env = process.env, send = sendEmail, auth = adminAuth() }) {
  const email = validEmail(token?.email)
  if (!email) return { sent: false, fallback: true }
  if (token.email_verified === true) return { sent: false, reason: 'already_verified' }
  if (!emailEnabled(env)) return { sent: false, fallback: true }
  let firebaseLink
  try {
    // No Firebase continue URL: our page carries its own `continue`, and a
    // continue URL would have to be an authorized domain in every project.
    firebaseLink = await auth.generateEmailVerificationLink(email)
  } catch (err) {
    await recordError(db, { source: 'server', where: 'auth.verify.link', error: err, now }).catch(() => {})
    return { sent: false, fallback: true }
  }
  const link = hengamActionLink(firebaseLink, { language: input.language, continuePath: '/dashboard', env })
  return deliver(db, { to: email, kind: 'verify', link, language: input.language, env, send, now })
}

/**
 * Signed out: a password reset link for an address. Always answers the same
 * way whether or not an account exists, so it cannot be used to find out who
 * has one. Limited per address as well as per caller.
 */
export async function sendPasswordReset({ db, input = {}, now, env = process.env, send = sendEmail, auth = adminAuth(), limit = consumeRateLimit }) {
  const email = validEmail(input.email)
  if (!email) return { ok: true }
  const perAddress = await limit('auth-reset-address', sha(email), 3, 60 * 60, { failClosed: true })
  if (!perAddress.allowed) return { ok: true }
  if (!emailEnabled(env)) return { ok: true, fallback: true }
  let firebaseLink
  try {
    firebaseLink = await auth.generatePasswordResetLink(email)
  } catch (err) {
    // No account (or a disabled one): say nothing different, send nothing.
    if (['auth/user-not-found', 'auth/email-not-found', 'auth/user-disabled'].includes(err?.code)) return { ok: true }
    // With email-enumeration protection on, Firebase answers an unknown
    // address with success and no link; the Admin SDK reports that as this.
    if (/Unable to create the email action link/i.test(String(err?.message))) return { ok: true }
    await recordError(db, { source: 'server', where: 'auth.reset.link', error: err, now }).catch(() => {})
    return { ok: true, fallback: true }
  }
  const link = hengamActionLink(firebaseLink, { language: input.language, continuePath: '/signin', env })
  const r = await deliver(db, { to: email, kind: 'reset', link, language: input.language, env, send, now })
  return r.sent ? { ok: true } : { ok: true, fallback: true }
}

/** How recently the person must have signed in (or confirmed their password) to change their email. */
export const EMAIL_CHANGE_FRESH_SECONDS = 5 * 60

/**
 * Signed in: start changing the account's sign-in email. A one-time link goes
 * to the NEW address only; the change happens when it is opened. Firebase
 * then sends its own "your sign-in email was changed" message to the old
 * address with a link to undo it, which we leave to Firebase on purpose.
 *
 * Like Firebase's own email change, it needs a recent sign-in. With
 * email-enumeration protection, an address that already has an account gets
 * the same answer and no email, so this cannot be used to find out who has
 * one.
 */
export async function requestEmailChange({ db, token, input = {}, now, env = process.env, send = sendEmail, auth = adminAuth(), limit = consumeRateLimit }) {
  const newEmail = validEmail(input.newEmail)
  if (!newEmail) return { sent: false, reason: 'invalid_email' }
  const authTime = Number(token?.auth_time) || 0
  if (Math.floor(+now / 1000) - authTime > EMAIL_CHANGE_FRESH_SECONDS) return { sent: false, reason: 'requires_recent_login' }
  let current
  try {
    current = validEmail((await auth.getUser(token.uid)).email)
  } catch (err) {
    await recordError(db, { source: 'server', where: 'auth.changeEmail.user', error: err, now }).catch(() => {})
    return { sent: false, fallback: true }
  }
  if (!current) return { sent: false, fallback: true }
  if (current.toLowerCase() === newEmail.toLowerCase()) return { sent: false, reason: 'same_email' }
  // Nobody's inbox can be flooded through this, whoever asks.
  const perAddress = await limit('auth-change-email-address', sha(newEmail), 3, 60 * 60, { failClosed: true })
  if (!perAddress.allowed) return { sent: false, reason: 'rate_limited' }
  if (!emailEnabled(env)) return { sent: false, fallback: true }
  let firebaseLink
  try {
    firebaseLink = await auth.generateVerifyAndChangeEmailLink(current, newEmail)
  } catch (err) {
    if (err?.code === 'auth/email-already-exists') return { sent: true }
    if (/Unable to create the email action link/i.test(String(err?.message))) return { sent: true }
    await recordError(db, { source: 'server', where: 'auth.changeEmail.link', error: err, now }).catch(() => {})
    return { sent: false, fallback: true }
  }
  const link = hengamActionLink(firebaseLink, { language: input.language, continuePath: '/signin', env })
  return deliver(db, { to: newEmail, kind: 'changeEmail', link, language: input.language, env, send, now })
}
