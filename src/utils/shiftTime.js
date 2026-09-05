// Shift times are wall-clock strings counted from the start of the day the
// shift belongs to. A late shift on a bar that trades 20:00 to 02:00 is stored
// as "20:00"-"26:00": arithmetic stays a plain subtraction, and only display
// has to turn 26:00 back into 2am the following morning.

const DAY_MINUTES = 24 * 60

export const NEXT_DAY_MARK = '+1'

export function toMinutes(value) {
  if (typeof value !== 'string') return 0
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h)) return 0
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

// Midnight itself closes the day it belongs to, so only times past it are
// marked as landing on the next day.
export function isNextDay(value) {
  return toMinutes(value) > DAY_MINUTES
}

// The same instant expressed as a real clock time: 26:00 becomes 02:00.
export function toWallClock(value) {
  const mins = toMinutes(value) % DAY_MINUTES
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

export function fromMinutes(mins) {
  const value = Math.max(0, Math.min(Math.round(mins), 48 * 60))
  if (value === DAY_MINUTES) return '24:00'
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

// A time picker only offers a 24-hour clock, so an end at or before the start
// means the shift runs into the next morning. Puts an edited shift back onto
// the same timeline the generator uses.
export function normalizeShiftTimes(shift) {
  const start = toMinutes(shift.start)
  let end = toMinutes(shift.end)
  if (end <= start) end += DAY_MINUTES
  return { ...shift, start: fromMinutes(start), end: fromMinutes(end) }
}

export function formatShiftTime(value, language = 'en', { marker = true } = {}) {
  if (!value) return ''
  const mins = toMinutes(value)
  const nextDay = mins > DAY_MINUTES
  const suffix = nextDay && marker ? ` ${NEXT_DAY_MARK}` : ''
  const wall = mins % DAY_MINUTES
  const h = Math.floor(wall / 60)
  const m = wall % 60

  if (language === 'fa') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${suffix}`
  }

  const period = h >= 12 ? 'pm' : 'am'
  const displayH = h % 12 === 0 ? 12 : h % 12
  return m === 0
    ? `${displayH}${period}${suffix}`
    : `${displayH}:${String(m).padStart(2, '0')}${period}${suffix}`
}

// "8pm – 2am +1". The marker goes on the range rather than on each end so a
// shift that starts and ends after midnight does not repeat it.
export function formatShiftRange(start, end, language = 'en', separator = '–') {
  if (!start || !end) return ''
  const startsNextDay = isNextDay(start)
  const endsNextDay = isNextDay(end)
  const left = formatShiftTime(start, language, { marker: false })
  const right = formatShiftTime(end, language, { marker: false })
  const suffix = startsNextDay || endsNextDay ? ` ${NEXT_DAY_MARK}` : ''
  return `${left} ${separator} ${right}${suffix}`
}

// Duration in hours. Times already share one timeline, so this is a plain
// subtraction — no midnight wrap-around guessing.
export function shiftLengthHours(start, end) {
  if (!start || !end) return 0
  return Math.round(((toMinutes(end) - toMinutes(start)) / 60) * 10) / 10
}
