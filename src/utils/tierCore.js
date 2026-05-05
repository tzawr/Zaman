export const TIERS = {
  FREE: 'free',
  PRO: 'pro',
}

export const TIER_LIMITS = {
  free: {
    maxEmployees: 5,
    maxGenerationsPer7Days: 2,
    maxScheduleHistory: 2,
    exportFormats: ['csv'],
    invites: false,
    plainLanguageRules: false,
    recommendations: false,
  },
  pro: {
    maxEmployees: Infinity,
    maxGenerationsPer7Days: Infinity,
    maxScheduleHistory: Infinity,
    exportFormats: ['csv', 'png', 'pdf'],
    invites: true,
    plainLanguageRules: true,
    recommendations: true,
  },
}

export function normalizeTier(tier) {
  return tier === TIERS.PRO || tier === 'business' ? TIERS.PRO : TIERS.FREE
}

export function timestampToMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

export function isOverrideActive(override, now = Date.now()) {
  if (!override?.tier) return false
  const expiresAt = timestampToMillis(override.expiresAt)
  return !expiresAt || expiresAt > now
}

export function resolveTierFromData({ user = null, override = null, subscriptionTier = null } = {}, now = Date.now()) {
  if (isOverrideActive(override, now)) return normalizeTier(override.tier)
  return normalizeTier(subscriptionTier || user?.subscriptionTier || user?.stripeTier || user?.tier)
}

export function block(reason, message) {
  return { blocked: true, reason, message }
}

export function allow(extra = {}) {
  return { blocked: false, ...extra }
}

export function canAddEmployeeForTier(tier, currentCount) {
  const resolved = normalizeTier(tier)
  const max = TIER_LIMITS[resolved].maxEmployees
  if (currentCount >= max) {
    return block('free_tier_limit', 'Free plan allows up to 5 employees. Upgrade to Pro for unlimited employees.')
  }
  return allow()
}

export function canGenerateScheduleForTier(tier, recentGenerations) {
  const resolved = normalizeTier(tier)
  const max = TIER_LIMITS[resolved].maxGenerationsPer7Days
  if (recentGenerations >= max) {
    return block('free_tier_limit', 'Free plan allows 2 schedule generations per week. Upgrade to Pro for unlimited.')
  }
  return allow()
}

export function canExportFormatForTier(tier, format) {
  const resolved = normalizeTier(tier)
  if (!TIER_LIMITS[resolved].exportFormats.includes(format)) {
    return block('free_tier_limit', 'Free plan includes CSV export only. Upgrade to Pro for PDF and PNG exports.')
  }
  return allow()
}

export function canInviteEmployeesForTier(tier) {
  return TIER_LIMITS[normalizeTier(tier)].invites
    ? allow()
    : block('free_tier_limit', 'Employee invites are available on Pro.')
}

export function canUsePlainLanguageRulesForTier(tier) {
  return TIER_LIMITS[normalizeTier(tier)].plainLanguageRules
    ? allow()
    : block('free_tier_limit', 'Plain-language rules are available on Pro. Free schedules use manual workspace settings only.')
}

export function canViewRecommendationsForTier(tier) {
  return TIER_LIMITS[normalizeTier(tier)].recommendations
}
