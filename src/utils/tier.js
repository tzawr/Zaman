import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db, auth } from '../firebase.js'
export {
  TIERS,
  TIER_LIMITS,
  allow,
  block,
  canAddEmployeeForTier,
  canExportFormatForTier,
  canGenerateScheduleForTier,
  canInviteEmployeesForTier,
  canUsePlainLanguageRulesForTier,
  canViewRecommendationsForTier,
  isOverrideActive,
  normalizeTier,
  resolveTierFromData,
  timestampToMillis,
} from './tierCore.js'

import {
  TIERS,
  TIER_LIMITS,
  allow,
  block,
  canAddEmployeeForTier,
  canExportFormatForTier,
  canGenerateScheduleForTier,
  canInviteEmployeesForTier,
  canUsePlainLanguageRulesForTier,
  normalizeTier,
  resolveTierFromData,
  timestampToMillis,
} from './tierCore.js'

export async function getUserTier(uid) {
  if (!uid) return TIERS.FREE
  const [userSnap, overrideSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDoc(doc(db, 'adminOverrides', uid)).catch(() => null),
  ])
  return resolveTierFromData({
    user: userSnap.exists() ? userSnap.data() : null,
    override: overrideSnap?.exists?.() ? overrideSnap.data() : null,
  })
}

export async function getRecentGenerationCount(uid, now = new Date()) {
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const q = query(
    collection(db, 'schedules'),
    where('userId', '==', uid),
    where('createdAt', '>', Timestamp.fromDate(sevenDaysAgo))
  )
  const snap = await getDocs(q)
  return snap.size
}

export async function canAddEmployee(uid, currentCount) {
  return canAddEmployeeForTier(await getUserTier(uid), currentCount)
}

export async function canGenerateSchedule(uid) {
  const tier = await getUserTier(uid)
  if (normalizeTier(tier) === TIERS.PRO) return allow({ tier, recentGenerations: 0 })
  const recentGenerations = await getRecentGenerationCount(uid)
  return { ...canGenerateScheduleForTier(tier, recentGenerations), tier, recentGenerations }
}

export async function canExport(uid, format) {
  return canExportFormatForTier(await getUserTier(uid), format)
}

export async function canExportPDF(uid) {
  return canExport(uid, 'pdf')
}

export async function canExportPNG(uid) {
  return canExport(uid, 'png')
}

export async function canUsePlainLanguageRules(uid) {
  return canUsePlainLanguageRulesForTier(await getUserTier(uid))
}

export async function canInviteEmployees(uid) {
  return canInviteEmployeesForTier(await getUserTier(uid))
}

export async function enforceScheduleHistoryLimit(uid) {
  const tier = await getUserTier(uid)
  const max = TIER_LIMITS[normalizeTier(tier)].maxScheduleHistory
  if (!Number.isFinite(max)) return
  const q = query(
    collection(db, 'schedules'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  )
  const snap = await getDocs(q)
  await Promise.all(snap.docs.slice(max).map(scheduleDoc => deleteDoc(scheduleDoc.ref)))
}

export async function redeemPromoCode(code) {
  if (!auth.currentUser) return block('auth_required', 'Sign in before redeeming a promo code.')
  return redeemPromoCodeClientOnly(code, auth.currentUser.uid)
}

export async function redeemPromoCodeClientOnly(code, userId, adminUid = 'promo-code') {
  const cleanCode = String(code || '').trim().toUpperCase()
  if (!cleanCode) return block('promo_invalid', 'Enter a promo code.')
  const promoRef = doc(db, 'promoCodes', cleanCode)
  const userRef = doc(db, 'users', userId)
  return runTransaction(db, async (tx) => {
    const promoSnap = await tx.get(promoRef)
    if (!promoSnap.exists()) return block('promo_invalid', 'Promo code not found.')
    const promo = promoSnap.data()
    const now = Date.now()
    const codeExpires = timestampToMillis(promo.expiresAt)
    if (!promo.active) return block('promo_inactive', 'This promo code is not active.')
    if (codeExpires && codeExpires <= now) return block('promo_expired', 'This promo code has expired.')
    if (promo.maxUses != null && Number(promo.usedCount || 0) >= Number(promo.maxUses)) {
      return block('promo_used_up', 'This promo code has already been used the maximum number of times.')
    }
    const durationDays = promo.durationDays == null ? null : Number(promo.durationDays)
    const expiresAt = durationDays ? Timestamp.fromDate(new Date(now + durationDays * 24 * 60 * 60 * 1000)) : null
    tx.set(userRef, {
      tier: normalizeTier(promo.tier),
      promoCode: cleanCode,
      promoTierExpiresAt: expiresAt,
      promoGrantedBy: adminUid,
      promoGrantedAt: serverTimestamp(),
    }, { merge: true })
    return allow({ message: 'Promo code applied. Pro access is active.' })
  })
}
