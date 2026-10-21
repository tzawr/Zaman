// Dates and times for Teams. A shift is entered as a business-local date and
// wall-clock times ("Tuesday 22:00 to 06:00 in America/Toronto") and stored
// twice: as those local values, which is what everyone reads, and as UTC
// instants, which is what arithmetic and conflict checks use. Converting
// between them goes through Intl so daylight-saving transitions land on the
// right instant without a timezone library.

export const DAY_MINUTES = 24 * 60
const MINUTE = 60 * 1000

// ---- Calendar dates: plain 'YYYY-MM-DD' strings, no timezone ---------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDateString(value) {
  const m = typeof value === 'string' && value.match(DATE_RE)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

function toUtcDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtcDate(date) {
  return date.toISOString().slice(0, 10)
}

export function addDays(dateStr, days) {
  const d = toUtcDate(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtcDate(d)
}

export function daysBetween(fromDate, toDate) {
  return Math.round((toUtcDate(toDate) - toUtcDate(fromDate)) / (DAY_MINUTES * MINUTE))
}

// 0 = Monday ... 6 = Sunday. Weeks start on Monday, as in Hengam.
export function weekdayIndex(dateStr) {
  return (toUtcDate(dateStr).getUTCDay() + 6) % 7
}

export function weekStartOf(dateStr) {
  return addDays(dateStr, -weekdayIndex(dateStr))
}

export function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

// The weeks shown for a month: whole Monday-to-Sunday rows covering it.
export function monthGrid(year, monthIndex) {
  const first = fromUtcDate(new Date(Date.UTC(year, monthIndex, 1)))
  const last = fromUtcDate(new Date(Date.UTC(year, monthIndex + 1, 0)))
  const weeks = []
  for (let start = weekStartOf(first); start <= last; start = addDays(start, 7)) weeks.push(weekDates(start))
  return weeks
}

export function monthOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number)
  return { year: y, monthIndex: m - 1 }
}

export function addMonths(dateStr, months) {
  const { year, monthIndex } = monthOf(dateStr)
  return fromUtcDate(new Date(Date.UTC(year, monthIndex + months, 1)))
}

// ---- Wall-clock times: minutes since midnight -------------------------------

export function parseTime(value) {
  const m = typeof value === 'string' && value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function formatClock(minutes) {
  const mins = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

// "9am", "9:30pm". Short, because it sits in narrow calendar cells.
export function formatTime12(minutes) {
  const mins = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const period = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour}${period}` : `${hour}:${String(m).padStart(2, '0')}${period}`
}

// ---- Time zones -------------------------------------------------------------

const formatters = new Map()
function partsFormatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }))
  }
  return formatters.get(tz)
}

// What a wall clock in `tz` reads at `instant`.
export function zonedParts(instant, tz) {
  const parts = Object.fromEntries(partsFormatter(tz).formatToParts(new Date(instant)).map(p => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.second),
  }
}

// How far ahead of UTC `tz` is at `instant`, in milliseconds.
function offsetAt(instant, tz) {
  const p = zonedParts(instant, tz)
  const asUtc = toUtcDate(p.date).getTime() + p.minutes * MINUTE + p.seconds * 1000
  return asUtc - Math.floor(instant / 1000) * 1000
}

// The instant a wall clock in `tz` shows `minutes` past midnight on `date`.
// A time skipped by a spring-forward gap is pushed past the gap, the way a
// clock would read it; a time that happens twice in the fall takes the first.
export function zonedToUtc(date, minutes, tz) {
  const wall = toUtcDate(date).getTime() + minutes * MINUTE
  const first = wall - offsetAt(wall, tz)
  const second = wall - offsetAt(first, tz)
  const candidates = [first, second].filter(t => {
    const p = zonedParts(t, tz)
    return p.date === addDays(date, Math.floor(minutes / DAY_MINUTES)) && p.minutes === minutes % DAY_MINUTES
  })
  if (candidates.length) return new Date(Math.min(...candidates))
  // Inside a gap: no instant reads this time. Use the later offset, which
  // lands just after the gap.
  return new Date(Math.max(first, second))
}

export function todayIn(tz, now = new Date()) {
  return zonedParts(now, tz).date
}

// ---- Shifts -----------------------------------------------------------------

export const MAX_SHIFT_HOURS = 16

// Resolves a shift entered as local values into stored fields. An end at or
// before the start runs into the next morning, as with Hengam's overnight
// shifts.
export function resolveShiftTimes({ date, start, end, timezone }) {
  if (!isDateString(date)) return { ok: false, message: 'Choose a date.' }
  const startMin = parseTime(start)
  const endMin = parseTime(end)
  if (startMin === null) return { ok: false, message: 'Enter a start time like 09:00.' }
  if (endMin === null) return { ok: false, message: 'Enter an end time like 17:00.' }
  if (startMin === endMin) return { ok: false, message: 'A shift needs to end after it starts.' }
  const overnight = endMin < startMin
  const startAt = zonedToUtc(date, startMin, timezone)
  const endAt = zonedToUtc(overnight ? addDays(date, 1) : date, endMin, timezone)
  const minutes = Math.round((endAt - startAt) / MINUTE)
  if (minutes <= 0) return { ok: false, message: 'A shift needs to end after it starts.' }
  if (minutes > MAX_SHIFT_HOURS * 60) return { ok: false, message: `A shift can be at most ${MAX_SHIFT_HOURS} hours.` }
  return {
    ok: true,
    value: {
      date, startLocal: formatClock(startMin), endLocal: formatClock(endMin), overnight,
      startAt, endAt, minutes,
    },
  }
}

export function overlaps(a, b) {
  return a.startAt < b.endAt && b.startAt < a.endAt
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

export function formatShiftRange(shift) {
  const start = formatTime12(parseTime(shift.startLocal))
  const end = formatTime12(parseTime(shift.endLocal))
  return `${start} – ${end}${shift.overnight ? ' (+1)' : ''}`
}

const LONG_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function formatDateLong(dateStr) {
  return LONG_DATE.format(toUtcDate(dateStr))
}

export function formatDateShort(dateStr) {
  return SHORT_DATE.format(toUtcDate(dateStr))
}

export function formatMonthYear(dateStr) {
  return MONTH_YEAR.format(toUtcDate(dateStr))
}

export function formatWeekRange(weekStart) {
  const end = addDays(weekStart, 6)
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${fmt.format(toUtcDate(weekStart))} – ${fmt.format(toUtcDate(end))}`
}

// "Today", "Tomorrow", or the date, relative to `today`.
export function relativeDay(dateStr, today) {
  const diff = daysBetween(today, dateStr)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return formatDateShort(dateStr)
}

// What people actually type into a time field: "9", "930", "9:30", "9.30pm",
// "21:00". Returns 'HH:MM', or null when it cannot be read as a time.
export function normalizeTimeInput(value) {
  if (typeof value !== 'string') return null
  const m = value.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const period = m[3]?.[0]
  if (min > 59) return null
  if (period) {
    if (h < 1 || h > 12) return null
    if (period === 'a' && h === 12) h = 0
    if (period === 'p' && h !== 12) h += 12
  }
  if (h > 23) return null
  return formatClock(h * 60 + min)
}
