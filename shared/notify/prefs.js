// What each notification is about, and who may turn it off.
//
// Every notification has a `type`. Its category decides which preference
// switch applies. Account and security messages are essential: they always
// go out by email and cannot be switched off, because they are how someone
// learns their account changed.

export const CATEGORIES = ['schedule', 'reminders', 'requests', 'team', 'billing', 'product']
export const ESSENTIAL = new Set(['account', 'security'])
export const CHANNELS = ['email', 'inApp']
export const LANGUAGES = ['en', 'fa']

export const TYPE_CATEGORY = {
  // Hengam Teams workflows (shared/teams/notifications.js)
  schedule_published: 'schedule',
  schedule_changed: 'schedule',
  shift_reminder: 'reminders',
  marketplace_shift: 'requests',
  pickup_requested: 'requests',
  pickup_decided: 'requests',
  swap_requested: 'requests',
  swap_decided: 'requests',
  time_off_requested: 'requests',
  time_off_decided: 'requests',
  // Hengam web events (shared/notify/web.js)
  invite_accepted: 'team',
  availability_changed: 'team',
  plan_activated: 'billing',
  welcome: 'account',
  password_changed: 'security',
  account_deleted: 'security',
}

export const categoryOf = (type) => TYPE_CATEGORY[type] || 'product'

// Sensible defaults: everything useful on, marketing off.
export const DEFAULT_PREFS = Object.freeze({
  email: Object.freeze({ schedule: true, reminders: true, requests: true, team: true, billing: true, product: false }),
  inApp: Object.freeze({ schedule: true, reminders: true, requests: true, team: true, billing: true, product: true }),
  language: null,
})

/** The stored preferences, filled with defaults and stripped of anything unknown. */
export function normalizePrefs(raw) {
  const out = { email: {}, inApp: {}, language: LANGUAGES.includes(raw?.language) ? raw.language : null }
  for (const channel of CHANNELS) {
    for (const c of CATEGORIES) {
      const v = raw?.[channel]?.[c]
      out[channel][c] = typeof v === 'boolean' ? v : DEFAULT_PREFS[channel][c]
    }
  }
  return out
}

/** Whether a notification of this type should go out on this channel. */
export function allows(rawPrefs, type, channel) {
  const category = categoryOf(type)
  if (ESSENTIAL.has(category)) return true
  return normalizePrefs(rawPrefs)[channel][category] !== false
}

/** The language a person reads notifications in. */
export function languageFor(user) {
  const l = user?.notificationPrefs?.language || user?.language
  return LANGUAGES.includes(l) ? l : 'en'
}
