// Calendar weeks for Hengam schedules: Monday to Sunday, as plain
// 'YYYY-MM-DD' dates with no time zone attached.
//
// Every schedule date in the web app goes through here. Dates used to be
// computed with local-time Date math and then written out with
// toISOString(), which is UTC: on a Tuesday evening in California the
// "next Monday" came out as the Tuesday after it, and in UTC+13 every day of
// a week came out one day early (HQA-08). Calendar dates are now pure
// calendar arithmetic (shared/teams/time.js, also used by Teams); a time zone
// is used only to decide what "today" is.

import { addDays, isDateString, todayIn, weekStartOf, weekdayIndex } from '../../shared/teams/time.js'

export const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The Monday of next week in the manager's own calendar. */
export function defaultWeekStart(now = new Date(), timeZone = localTimeZone()) {
  return addDays(weekStartOf(todayIn(timeZone, now)), 7)
}

export function isMonday(date) {
  return isDateString(date) && weekdayIndex(date) === 0
}

/** The Monday of the week containing `date`, or null for anything not a date. */
export function normalizeWeekStart(date) {
  return isDateString(date) ? weekStartOf(date) : null
}

export function weekDayDates(weekStart) {
  return DAY_KEYS.map((_, i) => addDays(weekStart, i))
}

export function dateForDay(weekStart, dayIndex) {
  return addDays(weekStart, dayIndex)
}

/** Weekday name ('Monday'...) of a calendar date. */
export function weekdayName(date) {
  return isDateString(date) ? DAY_NAMES[weekdayIndex(date)] : ''
}

const asUtc = (date) => new Date(`${date}T00:00:00Z`)
const localeFor = (language) => (language === 'fa' ? 'fa-IR-u-nu-latn' : 'en-US')

/** 'Nov 17' style label for a calendar date, the same in every time zone. */
export function formatDayDate(date, language = 'en') {
  if (!isDateString(date)) return ''
  return asUtc(date).toLocaleDateString(localeFor(language), { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** 'Nov 16 — Nov 22, 2026', or with both years when the week crosses one. */
export function formatWeekRange(weekStart, language = 'en') {
  if (!isDateString(weekStart)) return ''
  const end = addDays(weekStart, 6)
  const locale = localeFor(language)
  const year = (d) => asUtc(d).toLocaleDateString(locale, { year: 'numeric', timeZone: 'UTC' })
  if (year(weekStart) !== year(end)) {
    const full = (d) => asUtc(d).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    return `${full(weekStart)} — ${full(end)}`
  }
  return `${formatDayDate(weekStart, language)} — ${formatDayDate(end, language)}, ${year(weekStart)}`
}

/**
 * Whether a saved schedule's dates are a real Monday-to-Sunday week. Records
 * saved before the HQA-08 fix can start on another weekday (their "Monday"
 * column then carries Tuesday's date) or have every date one day off. Returns
 * null when consistent, otherwise what is wrong and the Monday of the week
 * the record most likely meant. Records are never rewritten: callers warn and
 * stop exports and publishing instead.
 */
export function scheduleDateProblem(weekStart, data) {
  if (!isDateString(weekStart)) return { kind: 'invalid', savedWeekStart: weekStart || '', monday: null }
  if (!isMonday(weekStart)) {
    return { kind: 'not_monday', savedWeekStart: weekStart, savedWeekday: weekdayName(weekStart), monday: weekStartOf(weekStart) }
  }
  const days = data?.days || {}
  for (const [i, key] of DAY_KEYS.entries()) {
    const date = days[key]?.date
    if (date && date !== addDays(weekStart, i)) {
      return { kind: 'dates_mismatch', savedWeekStart: weekStart, savedWeekday: 'Monday', day: key, date, monday: weekStart }
    }
  }
  return null
}
