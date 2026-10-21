import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

// Errors from the server and the app, grouped so the same failure a thousand
// times is one document with a count. `errorEvents/{day}_{fingerprint}` is
// server-only (no rule grants access); read it with scripts/teams-errors.js.
//
// Recording never throws: monitoring that fails must not turn a handled
// error into a second one.

export const ERROR_RETENTION_DAYS = 30
const MAX_MESSAGE = 500
const MAX_STACK = 4000

// Numbers, ids and quoted values vary between occurrences of one bug, so
// they are taken out before grouping.
function normalise(message) {
  return String(message || '')
    .replace(/"[^"]*"|'[^']*'/g, '""')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .slice(0, 200)
}

function firstFrame(stack) {
  return String(stack || '').split('\n').map(l => l.trim()).find(l => l.startsWith('at ')) || ''
}

export function fingerprintOf({ source, where, message, stack }) {
  return createHash('sha256')
    .update([source, where, normalise(message), firstFrame(stack).replace(/:\d+:\d+\)?$/, '')].join('|'))
    .digest('hex').slice(0, 16)
}

const dayOf = (now) => now.toISOString().slice(0, 10)

// source: 'server' | 'app' | 'cron'. where: the action, route or job part.
export async function recordError(db, { source, where, error, uid = null, context = null, now = new Date() }) {
  try {
    const message = String(error?.message || error || 'Unknown error').slice(0, MAX_MESSAGE)
    const stack = String(error?.stack || '').slice(0, MAX_STACK)
    const fingerprint = fingerprintOf({ source, where, message, stack })
    const ref = db.collection('errorEvents').doc(`${dayOf(now)}_${fingerprint}`)
    const seen = Timestamp.fromDate(now)
    try {
      await ref.create({
        source, where: String(where || '').slice(0, 120), fingerprint, day: dayOf(now),
        message, stack, context, uids: uid ? [uid] : [], count: 1, firstSeen: seen, lastSeen: seen,
      })
    } catch (err) {
      if (err?.code !== 6) throw err // ALREADY_EXISTS
      await ref.update({
        count: FieldValue.increment(1), lastSeen: seen,
        // Who was affected, to tell one unlucky person from everyone.
        ...(uid ? { uids: FieldValue.arrayUnion(uid) } : {}),
      })
    }
    return fingerprint
  } catch (err) {
    console.error('could not record error:', err?.message || err)
    return null
  }
}

// Reported by the app: a crash it caught, or an unhandled rejection. Anyone
// may send one, even before sign-in, so it is bounded in size and rate
// (see the router) and stored as text only.
export async function reportClientError({ db, uid, input, now }) {
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
  const error = { message: text(input?.message, MAX_MESSAGE) || 'Unknown error', stack: text(input?.stack, MAX_STACK) }
  const context = {
    route: text(input?.route, 200),
    platform: text(input?.platform, 20),
    appVersion: text(input?.appVersion, 40),
    componentStack: text(input?.componentStack, 2000),
  }
  await recordError(db, { source: 'app', where: context.route || 'unknown', error, uid, context, now })
  return { ok: true }
}

// The daily job's summary of yesterday and today, for the logs, and the
// removal of anything past retention.
export async function summariseAndPruneErrors(db, now = new Date()) {
  const cutoff = dayOf(new Date(now.getTime() - ERROR_RETENTION_DAYS * 24 * 60 * 60 * 1000))
  let pruned = 0
  for (;;) {
    const old = await db.collection('errorEvents').where('day', '<', cutoff).limit(400).get()
    if (old.empty) break
    const batch = db.batch()
    old.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    pruned += old.size
    if (old.size < 400) break
  }
  const since = dayOf(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const recent = await db.collection('errorEvents').where('day', '>=', since).get()
  const groups = recent.docs.map(d => d.data())
  return {
    errorGroups: groups.length,
    errorCount: groups.reduce((sum, g) => sum + (g.count || 0), 0),
    errorsPruned: pruned,
  }
}
