import { appOrigin, emailEnabled, inviteEmail, sendEmail, validEmail, welcomeEmail } from './_email.js'
import { requireId } from './_teams-common.js'
import { conflict, forbidden, invalid, notFound } from './_teams-http.js'

const RESEND_GAP_MS = 10 * 60 * 1000
const lang = (value) => (value === 'fa' ? 'fa' : 'en')

/**
 * Emails an employee the invite link their manager just made. Only the
 * manager who owns an unused invite can send it, at most once every 10
 * minutes, and the link is always built from APP_ORIGIN, never the request.
 */
export async function emailInvite({ db, uid, input, now, env = process.env, send = sendEmail }) {
  const inviteId = requireId(input.inviteId, 'invite')
  const to = validEmail(input.email)
  if (!to) throw invalid('That email address does not look right.')
  if (!emailEnabled(env)) throw conflict('email_off', 'Email is not set up yet. Copy the link and send it yourself.')

  const ref = db.doc(`invites/${inviteId}`)
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw notFound('That invite does not exist.')
    const inv = snap.data()
    if (inv.managerId !== uid) throw forbidden('Only the manager who made this invite can send it.')
    if (inv.used) throw conflict('used', 'This invite has already been used.')
    const last = inv.emailedAt?.toDate?.() || (inv.emailedAt instanceof Date ? inv.emailedAt : null)
    if (last && now - last < RESEND_GAP_MS) throw conflict('too_soon', 'This invite was just emailed. Wait a few minutes before sending it again.')
    const manager = (await tx.get(db.doc(`users/${uid}`))).data() || {}
    tx.update(ref, { emailedAt: now })
    return { inv, manager, last: inv.emailedAt ?? null }
  })

  const message = inviteEmail({
    businessName: claimed.manager.businessName,
    employeeName: claimed.inv.employeeName,
    link: `${appOrigin(env)}/invite/${inviteId}`,
    language: lang(input.language),
  })
  try {
    await send({ to, ...message, tag: 'invite' }, { env })
  } catch (err) {
    // Not sent: give the slot back so the manager can retry straight away.
    await ref.update({ emailedAt: claimed.last }).catch(() => {})
    throw err
  }
  return { sent: true }
}

/** One welcome email per account, to its own verified address, after onboarding. */
export async function sendWelcome({ db, uid, token, input = {}, now, env = process.env, send = sendEmail }) {
  if (token?.email_verified !== true || !validEmail(token?.email)) return { sent: false, reason: 'unverified' }
  if (!emailEnabled(env)) return { sent: false, reason: 'disabled' }
  const ref = db.doc(`users/${uid}`)
  const user = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.data()
    if (!data || data.accountType === 'employee' || data.onboarded !== true || data.welcomeEmailSentAt) return null
    tx.update(ref, { welcomeEmailSentAt: now })
    return data
  })
  if (!user) return { sent: false, reason: 'not_needed' }
  try {
    await send({ to: token.email, ...welcomeEmail({ name: user.displayName || user.ownerName, origin: appOrigin(env), language: lang(input.language) }), tag: 'welcome' }, { env })
  } catch (err) {
    await ref.update({ welcomeEmailSentAt: null }).catch(() => {})
    throw err
  }
  return { sent: true }
}
