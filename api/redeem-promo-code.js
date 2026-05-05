import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { initAdmin, requireSignedIn } from './_firebase-admin.js'

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

  try {
    initAdmin()
    const decoded = await requireSignedIn(req)
    const userId = decoded.uid
    const cleanCode = String(req.body?.code || '').trim().toUpperCase()
    if (!cleanCode) return block(res, 400, 'promo_invalid', 'Enter a promo code.')

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
      return { blocked: false, message: 'Promo code applied. Pro access is active.' }
    })

    if (result.blocked) return block(res, 400, result.reason, result.message)
    return res.status(200).json(result)
  } catch (err) {
    console.error('Promo redemption failed:', err)
    return res.status(500).json({ blocked: true, reason: 'server_error', message: 'Promo redemption is not configured yet.' })
  }
}
