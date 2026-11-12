import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { allows, categoryOf, ESSENTIAL, languageFor } from '../shared/notify/prefs.js'
import { notificationText } from '../shared/notify/text.js'
import { appOrigin, emailEnabled, notificationEmail, securityFrom, sendEmail, validEmail } from './_email.js'
import { recordError } from './_monitoring.js'

// The one place every notification goes through, whatever produced it
// (a Teams workflow, a Hengam web event, a reminder job).
//
// An entry is { uid, key, type, title, body, link, app, facts, bizId? }:
//   - key makes it unique: the in-app document id and the email outbox id
//     both derive from it, so delivering the same event twice is one
//     notification, one push and one email;
//   - app is 'teams' (links into the Teams app) or 'web' (links into hengam.app).
//
// Delivery runs after the change it describes has been committed, and every
// failure here is caught by the caller: a notification problem never undoes
// a saved schedule.

const DAY = 24 * 60 * 60 * 1000
export const RETENTION = { notification: 90 * DAY, outbox: 14 * DAY, log: 180 * DAY }
export const MAX_ATTEMPTS = 6
const EMAILS_PER_USER_PER_HOUR = 12

export const sha = (s) => createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex')
const ts = (d) => Timestamp.fromDate(d)
const outboxId = (uid, key) => `${uid}_${key}`.slice(0, 400)

/** Seconds to wait before attempt n (1-based): 1m, 5m, 25m, 2h, 6h. */
export function backoffMs(attempt) {
  return Math.min(60_000 * 5 ** Math.max(0, attempt - 1), 6 * 60 * 60 * 1000)
}

/**
 * Writes in-app notifications, queues pushes and emails, honouring each
 * person's preferences. Returns the ids queued so the caller can send them
 * now instead of waiting for the next job.
 */
export async function persistNotifications(db, entries, now = new Date()) {
  if (!entries?.length) return { written: 0, queued: [], emails: [] }
  const uids = [...new Set(entries.map(e => e.uid))]
  const users = new Map((await db.getAll(...uids.map(u => db.doc(`users/${u}`)))).map(s => [s.id, s.data() || {}]))

  const pushRefs = entries.map(e => db.doc(`pushQueue/${e.uid}_${e.key}`))
  const mailRefs = entries.map(e => db.doc(`emailOutbox/${outboxId(e.uid, e.key)}`))
  const [pushSeen, mailSeen] = await Promise.all([db.getAll(...pushRefs), db.getAll(...mailRefs)])

  const at = ts(now)
  const expireAt = ts(new Date(+now + RETENTION.notification))
  let batch = db.batch()
  let ops = 0
  const queued = []
  const emails = []
  let written = 0
  const flush = async (force) => { if (ops && (force || ops >= 400)) { await batch.commit(); batch = db.batch(); ops = 0 } }

  for (const [i, e] of entries.entries()) {
    const prefs = users.get(e.uid)?.notificationPrefs
    const lang = languageFor(users.get(e.uid))
    if (allows(prefs, e.type, 'inApp') && !ESSENTIAL.has(categoryOf(e.type))) {
      const first = !pushSeen[i].exists
      // readAt is set only when new, so a retry never marks it unread again.
      batch.set(db.doc(`users/${e.uid}/notifications/${e.key}`), {
        type: e.type, title: e.title, body: e.body, link: e.link || null, app: e.app || 'teams',
        facts: e.facts || {}, ...(e.bizId ? { bizId: e.bizId } : {}),
        createdAt: at, expireAt, ...(first ? { readAt: null } : {}),
      }, { merge: true })
      ops++
      written++
      if (first && (e.app || 'teams') === 'teams') {
        batch.set(pushRefs[i], { uid: e.uid, title: e.title, body: e.body, link: e.link || null, status: 'pending', attempts: 0, createdAt: at })
        ops++
        queued.push(pushRefs[i].id)
      }
    }
    if (!mailSeen[i].exists && allows(prefs, e.type, 'email')) {
      batch.set(mailRefs[i], {
        uid: e.uid, type: e.type, category: categoryOf(e.type), lang,
        title: e.title, body: e.body, link: e.link || null, app: e.app || 'teams', facts: e.facts || {},
        status: 'pending', attempts: 0, createdAt: at, nextAttemptAt: at,
        expireAt: ts(new Date(+now + RETENTION.outbox)),
      })
      ops++
      emails.push(mailRefs[i].id)
    }
    await flush(false)
  }
  await flush(true)
  return { written, queued, emails }
}

/** Where a notification link opens, as an absolute https URL on our domains. */
export function absoluteLink(app, link, env = process.env) {
  const base = app === 'web' ? appOrigin(env) : (env.TEAMS_APP_ORIGIN || 'https://teams.hengam.app').replace(/\/+$/, '')
  const path = typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : '/'
  return `${base}${path}`
}

/** The verified address for an account, or null. Injected in tests. */
export async function verifiedAddress(uid) {
  const { getAuth } = await import('firebase-admin/auth')
  try {
    const u = await getAuth().getUser(uid)
    return u.emailVerified && validEmail(u.email) ? u.email : null
  } catch { return null }
}

async function suppressed(db, email) {
  return (await db.doc(`emailSuppressions/${sha(email)}`).get()).exists
}

function logEntry(row, status, extra, now) {
  // No subject, body or address: type, category, a hash and the outcome.
  return {
    type: row.type, category: row.category, uidHash: sha(row.uid).slice(0, 16), status,
    attempts: row.attempts, at: ts(now), expireAt: ts(new Date(+now + RETENTION.log)), ...extra,
  }
}

/**
 * Sends due emails from the outbox: the ids just queued, or (from the daily
 * job) anything whose retry time has come. Each email is claimed in a
 * transaction first, so two runs never send the same one.
 */
export async function drainEmailOutbox(db, { ids = null, now = new Date(), env = process.env, send = sendEmail, address = verifiedAddress, limit = 50 } = {}) {
  if (!emailEnabled(env)) return { sent: 0, failed: 0, skipped: 'disabled' }
  let refs
  if (ids) refs = ids.slice(0, limit).map(id => db.doc(`emailOutbox/${id}`))
  else {
    const snap = await db.collection('emailOutbox').where('status', 'in', ['pending', 'retry']).where('nextAttemptAt', '<=', ts(now)).limit(limit).get()
    refs = snap.docs.map(d => d.ref)
  }
  let sent = 0, failed = 0
  const { consumeRateLimit } = await import('./_rate-limit.js')
  for (const ref of refs) {
    const row = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const r = snap.data()
      if (!r || !['pending', 'retry'].includes(r.status) || r.nextAttemptAt.toMillis() > +now) return null
      tx.update(ref, { status: 'sending', claimedAt: ts(now) })
      return r
    })
    if (!row) continue
    const finish = async (status, extra = {}) => {
      const batch = db.batch()
      // Delivered or given up: the content is no longer needed.
      batch.update(ref, { status, ...extra, ...(status === 'sent' || status === 'dropped' || status === 'failed' ? { title: null, body: null, facts: null } : {}) })
      batch.set(db.collection('emailLog').doc(), logEntry(row, status, { providerId: extra.providerId || null, reason: extra.reason || null }, now))
      await batch.commit()
    }
    const to = await address(row.uid)
    if (!to) { await finish('dropped', { reason: 'no_verified_address' }); continue }
    if (await suppressed(db, to)) { await finish('dropped', { reason: 'suppressed' }); continue }
    if (!ESSENTIAL.has(row.category)) {
      const lim = await consumeRateLimit('email-user', row.uid, EMAILS_PER_USER_PER_HOUR, 3600, { failClosed: false })
      if (!lim.allowed) { await finish('dropped', { reason: 'user_hourly_cap' }); continue }
    }
    const text = notificationText(row.type, row.facts || {}, row.lang)
    const message = notificationEmail({
      lang: row.lang, type: row.type, category: row.category,
      title: (row.lang === 'fa' && text?.title) || row.title || text?.title || 'HENGAM',
      body: (row.lang === 'fa' && text?.body) || row.body || text?.body || '',
      actionUrl: absoluteLink(row.app, row.link, env), origin: appOrigin(env),
    })
    try {
      const r = await send({ to, ...message, tag: row.type }, { env })
      if (r && r.sent === false) {
        // Refused before reaching the provider (allowlist, email switched off).
        await finish('dropped', { reason: String(r.reason || 'not_sent').slice(0, 40) })
        continue
      }
      await finish('sent', { sentAt: ts(now), providerId: r?.id || null, attempts: row.attempts + 1 })
      sent++
    } catch (err) {
      const attempts = row.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await finish('failed', { attempts, reason: String(err?.message || err).slice(0, 120) })
        await recordError(db, { source: 'server', where: 'email.send', error: err, now }).catch(() => {})
      } else {
        await ref.update({ status: 'retry', attempts, nextAttemptAt: ts(new Date(+now + backoffMs(attempts))), lastError: String(err?.message || err).slice(0, 120) })
      }
      failed++
    }
  }
  return { sent, failed }
}

/**
 * An essential email to a known address, without an in-app notification:
 * password changed, account deleted. Sent now; logged without content.
 */
export async function sendEssentialEmail(db, { to, type, lang = 'en', now = new Date(), env = process.env, send = sendEmail, uid = null }) {
  if (!emailEnabled(env)) return { sent: false, reason: 'disabled' }
  const address = validEmail(to)
  if (!address) return { sent: false, reason: 'no_address' }
  const text = notificationText(type, {}, lang)
  const message = notificationEmail({ lang, type, category: categoryOf(type), title: text.title, body: text.body, actionUrl: `${appOrigin(env)}${type === 'password_changed' ? '/forgot-password' : '/'}`, origin: appOrigin(env) })
  const row = { type, category: categoryOf(type), uid: uid || address, attempts: 0 }
  try {
    const r = await send({ to: address, ...message, tag: type, from: categoryOf(type) === 'security' ? securityFrom(env) : null }, { env })
    if (r && r.sent === false) {
      await db.collection('emailLog').add(logEntry(row, 'dropped', { reason: String(r.reason || 'not_sent').slice(0, 40) }, now))
      return { sent: false, reason: r.reason || 'not_sent' }
    }
    await db.collection('emailLog').add(logEntry(row, 'sent', { providerId: r?.id || null }, now))
    return { sent: true }
  } catch (err) {
    await db.collection('emailLog').add(logEntry(row, 'failed', { reason: String(err?.message || err).slice(0, 120) }, now))
    await recordError(db, { source: 'server', where: 'email.essential', error: err, now }).catch(() => {})
    return { sent: false, reason: 'provider_error' }
  }
}

/**
 * Deletes outbox and log rows past their expireAt. (Notifications carry an
 * expireAt too, for a Firestore TTL policy; see docs/NOTIFICATIONS.md.)
 */
export async function pruneExpired(db, now = new Date(), { limit = 400 } = {}) {
  let pruned = 0
  for (const name of ['emailOutbox', 'emailLog']) {
    const snap = await db.collection(name).where('expireAt', '<', ts(now)).limit(limit).get()
    if (snap.empty) continue
    const batch = db.batch()
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    pruned += snap.size
  }
  return pruned
}
