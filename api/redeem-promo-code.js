import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { initAdmin, requireSignedIn, sendError } from './_firebase-admin.js'
import { consumeRateLimit, sendRateLimited } from './_rate-limit.js'
import { drainEmailOutbox, persistNotifications } from './_notify.js'
import { recordError } from './_monitoring.js'

function block(res, status, reason, message) {
  return res.status(status).json({ blocked: true, reason, message })
}

function timestampMs(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let userId
  try {
    initAdmin()
    const decoded = await requireSignedIn(req)
    userId = decoded.uid
  } catch (err) {
    // Previously this fell into the catch-all below, so an expired session came
    // back as a 500 and the client could not tell it just needed to sign in.
    return sendError(res, err, 'Sign in to redeem a promo code.')
  }

  try {
    const cleanCode = String(req.body?.code || '').trim().toUpperCase()
    if (!cleanCode) return block(res, 400, 'promo_invalid', 'Enter a promo code.')
    // A promo code is a bearer secret and a wrong guess is cheap, so without a
    // limit the endpoint is a namespace to walk. Ten an hour leaves room for
    // fat fingers and none for a dictionary.
    const limit = await consumeRateLimit('promo', userId, 10, 60 * 60, { failClosed: true })
    if (!limit.allowed) {
      return sendRateLimited(
        res,
        limit.retryAfterSeconds,
        'Too many promo code attempts. Try again in a little while.'
      )
    }

    const db = getFirestore()
    const promoRef = db.collection('promoCodes').doc(cleanCode)
    const overrideRef = db.collection('adminOverrides').doc(userId)

    const result = await db.runTransaction(async (tx) => {
      const promoSnap = await tx.get(promoRef)
      if (!promoSnap.exists) return { blocked: true, reason: 'promo_invalid', message: 'Promo code not found.' }

      const promo = promoSnap.data()
      const now = Date.now()
      const expiresAtMs = timestampMs(promo.expiresAt)
      if (!promo.active) return { blocked: true, reason: 'promo_inactive', message: 'This promo code is not active.' }
      if (expiresAtMs && expiresAtMs <= now) return { blocked: true, reason: 'promo_expired', message: 'This promo code has expired.' }
      if (promo.maxUses != null && Number(promo.usedCount || 0) >= Number(promo.maxUses)) {
        return { blocked: true, reason: 'promo_used_up', message: 'This promo code has already been used the maximum number of times.' }
      }

      const durationDays = promo.durationDays == null ? null : Number(promo.durationDays)
      const overrideExpiresAt = durationDays
        ? Timestamp.fromDate(new Date(now + durationDays * 24 * 60 * 60 * 1000))
        : null

      tx.set(overrideRef, {
        tier: 'pro',
        expiresAt: overrideExpiresAt,
        reason: `promo code ${cleanCode}`,
        grantedBy: 'promo-code',
        grantedAt: FieldValue.serverTimestamp(),
        code: cleanCode,
      })
      tx.update(promoRef, { usedCount: FieldValue.increment(1) })
      return { blocked: false, message: 'Promo code applied. Pro access is active.', until: overrideExpiresAt ? overrideExpiresAt.toDate().toISOString().slice(0, 10) : null }
    })

    if (result.blocked) return block(res, 400, result.reason, result.message)
    // Tell them (in the app and by email). The plan is already active, so a
    // failure here is logged and nothing else.
    try {
      const day = new Date().toISOString().slice(0, 10)
      const r = await persistNotifications(db, [{ uid: userId, key: `web_plan_${cleanCode}_${day}`.replace(/[^A-Za-z0-9_-]/g, '-'), type: 'plan_activated', app: 'web', link: '/dashboard',
        title: 'HENGAM Pro is active', body: result.until ? `Your Pro access runs until ${result.until}.` : 'Your Pro features are ready to use.', facts: { until: result.until } }])
      if (r.emails.length) await drainEmailOutbox(db, { ids: r.emails })
    } catch (err) {
      await recordError(db, { source: 'server', where: 'redeem-promo-code:notify', error: err, uid: userId })
    }
    const { until: _until, ...publicResult } = result
    return res.status(200).json(publicResult)
  } catch (err) {
    console.error('Promo redemption failed:', err)
    await recordError(getFirestore(), { source: 'server', where: 'redeem-promo-code', error: err, uid: userId })
    return res.status(500).json({ blocked: true, reason: 'server_error', message: 'Something went wrong on our end. Try again in a moment.' })
  }
}
