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

/**
 * Hengam web events that people should hear about. The browser says what just
 * happened; the server checks it really did, from the stored records, and
 * works out who to tell. Nothing the caller sends is trusted as fact.
 */
export async function reportEvent({ db, uid, input, now, env = process.env, deliverWeb = null, essential = null }) {
  const { persistNotifications, drainEmailOutbox, sendEssentialEmail } = await import('./_notify.js')
  const deliverNow = deliverWeb || (async (entries) => {
    const r = await persistNotifications(db, entries, now)
    if (r.emails.length) await drainEmailOutbox(db, { ids: r.emails, now, env }).catch(() => {})
    return r
  })
  const type = String(input?.type || '')

  if (type === 'invite_accepted') {
    const inviteId = requireId(input.inviteId, 'invite')
    const inv = (await db.doc(`invites/${inviteId}`).get()).data()
    if (!inv || inv.used !== true || inv.usedBy !== uid) throw forbidden('That invite was not accepted by you.')
    await deliverNow([{ uid: inv.managerId, key: `web_inv_${inviteId}`, type, app: 'web', link: '/employees',
      title: `${inv.employeeName || 'Your employee'} joined your team`, body: 'They can now see their shifts and send you their availability.',
      facts: { who: String(inv.employeeName || '').slice(0, 80) } }])
    return { ok: true }
  }

  if (type === 'availability_changed') {
    const me = (await db.doc(`users/${uid}`).get()).data()
    if (me?.accountType !== 'employee' || !me.managerId || !me.linkedEmployeeId) throw forbidden('Only a linked employee can report this.')
    // Only right after the employee really saved availability or time off.
    const savedAt = [me.availabilityUpdatedAt, me.timeOffUpdatedAt].map(t => t?.toDate?.()?.getTime?.() ?? 0)
    if (!savedAt.some(t => Math.abs(+now - t) < 10 * 60_000)) return { ok: true, sent: false }
    const emp = (await db.doc(`employees/${me.linkedEmployeeId}`).get()).data()
    if (!emp || emp.userId !== me.managerId) throw forbidden('That employee is not on your manager’s team.')
    // One notification per employee per hour, however many saves.
    const hour = Math.floor(+now / 3_600_000)
    await deliverNow([{ uid: me.managerId, key: `web_avail_${me.linkedEmployeeId}_${hour}`, type, app: 'web', link: `/employees/${me.linkedEmployeeId}/availability`,
      title: `${emp.name || 'An employee'} updated their availability`, body: 'Check it before you build the next schedule.',
      facts: { who: String(emp.name || '').slice(0, 80) } }])
    return { ok: true }
  }

  if (type === 'password_changed') {
    // Only right after a real change: Firebase moves tokensValidAfterTime when
    // a password changes. The email goes to the account's own verified address.
    const { getAuth } = await import('firebase-admin/auth')
    const user = await getAuth().getUser(uid)
    const changedAt = Date.parse(user.tokensValidAfterTime || '')
    if (!Number.isFinite(changedAt) || Math.abs(+now - changedAt) > 15 * 60_000) return { ok: true, sent: false }
    if (!user.emailVerified || !validEmail(user.email)) return { ok: true, sent: false }
    const lang = input?.language === 'fa' ? 'fa' : 'en'
    const r = await (essential || sendEssentialEmail)(db, { to: user.email, type, lang, now, env, uid })
    return { ok: true, sent: !!r?.sent }
  }

  throw invalid('Unknown event.')
}
