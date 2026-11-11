import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { recordError } from './_monitoring.js'

// The AI endpoint bounds itself with a spend cap, but the other endpoints had
// nothing: a signed-in caller could mail-bomb their own inbox on our Resend
// quota, or walk the promo-code namespace one guess at a time. This is the
// shared counter both of those now sit behind.
//
// Firestore rather than memory, because serverless instances are recycled and
// a per-instance counter resets whenever the platform feels like it.

function windowKey(windowSeconds) {
  return Math.floor(Date.now() / (windowSeconds * 1000))
}

/**
 * Counts one attempt against `key` and reports whether the caller is over the
 * limit. The first `limit` attempts in a window are allowed; every one after
 * that is refused until the window rolls over, and refused attempts are not
 * counted.
 *
 * Fails open by default: if the counter itself is broken, that is our fault
 * and it should not lock a legitimate user out of verifying their email. A
 * limit that guards a secret (invite and promo codes) passes failClosed, since
 * there an attacker who can make the counter fail, for example by hammering
 * one document until its transactions abort, would otherwise get unlimited
 * guesses.
 *
 * @param {string} bucket   endpoint name, so limits never collide
 * @param {string} key      per-caller identity, normally a uid
 * @param {number} limit    attempts allowed inside the window
 * @param {number} windowSeconds
 * @param {{ failClosed?: boolean }} [options]
 * @returns {Promise<{ allowed: boolean, retryAfterSeconds: number, remaining: number }>}
 */
export async function consumeRateLimit(bucket, key, limit, windowSeconds, { failClosed = false } = {}) {
  const db = getFirestore()
  const slot = windowKey(windowSeconds)
  // A document id may not contain '/' (it would be read as a path), and an
  // IPv6 identity such as 2001:db8::/64 does.
  const safeKey = String(key).replace(/\//g, '|').slice(0, 200) || 'none'
  const ref = db.collection('rateLimits').doc(`${bucket}_${safeKey}_${slot}`)
  const retryAfter = () => Math.max(1, (slot + 1) * windowSeconds - Math.floor(Date.now() / 1000))

  try {
    const count = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const current = snap.exists ? Number(snap.data().count) || 0 : 0
      // Over the limit: refuse without writing. This used to return `current`
      // (== limit), which the `> limit` check below then let through, so every
      // attempt after the limit was allowed.
      if (current >= limit) return limit + 1
      tx.set(ref, {
        bucket,
        key,
        count: current + 1,
        // Stamped so a scheduled cleanup or a TTL policy can sweep old windows.
        expiresAt: new Date((slot + 1) * windowSeconds * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return current + 1
    })

    if (count > limit) return { allowed: false, retryAfterSeconds: retryAfter(), remaining: 0 }
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - count }
  } catch (err) {
    console.error(`rate limit check failed (${bucket}, ${failClosed ? 'closed' : 'open'}):`, err.message)
    await recordError(db, { source: 'server', where: `rate-limit:${bucket}`, error: err, context: { failClosed } })
    if (failClosed) return { allowed: false, retryAfterSeconds: Math.min(60, windowSeconds), remaining: 0 }
    return { allowed: true, retryAfterSeconds: 0, remaining: 0 }
  }
}

export function sendRateLimited(res, retryAfterSeconds, message) {
  res.setHeader('Retry-After', String(retryAfterSeconds))
  return res.status(429).json({
    blocked: true,
    reason: 'rate_limited',
    message,
  })
}
