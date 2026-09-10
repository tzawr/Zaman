import { FieldValue, getFirestore } from 'firebase-admin/firestore'

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
 * limit. Fails open: if the counter itself is broken, that is our fault and it
 * should not lock a legitimate user out of verifying their email.
 *
 * @param {string} bucket   endpoint name, so limits never collide
 * @param {string} key      per-caller identity, normally a uid
 * @param {number} limit    attempts allowed inside the window
 * @param {number} windowSeconds
 * @returns {Promise<{ allowed: boolean, retryAfterSeconds: number }>}
 */
export async function consumeRateLimit(bucket, key, limit, windowSeconds) {
  const db = getFirestore()
  const slot = windowKey(windowSeconds)
  const ref = db.collection('rateLimits').doc(`${bucket}_${key}_${slot}`)

  try {
    const count = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const current = snap.exists ? Number(snap.data().count) || 0 : 0
      if (current >= limit) return current
      tx.set(ref, {
        bucket,
        key,
        count: FieldValue.increment(1),
        // Stamped so a scheduled cleanup or a TTL policy can sweep old windows.
        expiresAt: new Date((slot + 1) * windowSeconds * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return current + 1
    })

    if (count > limit) {
      const secondsIntoWindow = Math.floor(Date.now() / 1000) % windowSeconds
      return { allowed: false, retryAfterSeconds: windowSeconds - secondsIntoWindow }
    }
    return { allowed: true, retryAfterSeconds: 0 }
  } catch (err) {
    console.error('rate limit check failed:', err.message)
    return { allowed: true, retryAfterSeconds: 0 }
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
