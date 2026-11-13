// Product feature flags, shared by the web app and the server.
//
// TEMPORARY (2026-11-13): HENGAM runs English-only and dark-only. Persian and
// light mode are switched off here, not removed: every translation, RTL rule,
// light-mode style and saved preference is kept. To bring one back, set its
// flag to true; nothing else needs to change.

export const FEATURES = Object.freeze({
  /** Persian UI, right-to-left layout and Persian emails/notifications. */
  persian: false,
  /** The light theme and the theme switcher. */
  lightMode: false,
})

/**
 * The language to actually use for a requested one. With Persian off,
 * everything is English, whatever was asked for or saved.
 * @param {unknown} requested
 * @param {{ persian?: boolean }} [features]
 * @returns {'en'|'fa'}
 */
export function effectiveLanguage(requested, features = FEATURES) {
  return features.persian && requested === 'fa' ? 'fa' : 'en'
}

/**
 * Whether to use the dark theme, given the saved choice ('light' | 'dark' |
 * null). With light mode off this is always true; the saved choice is left as
 * it is for when light mode returns.
 * @param {string|null|undefined} saved
 * @param {{ lightMode?: boolean }} [features]
 */
export function effectiveDarkMode(saved, features = FEATURES) {
  if (!features.lightMode) return true
  return saved !== 'light'
}
