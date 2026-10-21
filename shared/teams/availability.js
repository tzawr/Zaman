// Availability and time off, as rules that do not depend on where they run.
// The server validates submissions with them; the app uses the same functions
// to summarise availability and to warn a manager before they schedule
// someone when they said they could not work.

import {
  DAY_MINUTES, addDays, daysBetween, formatClock, formatDateShort, formatTime12, isDateString,
  normalizeTimeInput, parseTime, weekdayIndex,
} from './time.js'

export const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const MAX_WINDOWS_PER_DAY = 2
export const MAX_OVERRIDES = 30
export const MAX_TIME_OFF_DAYS = 60

export const TIME_OFF_LABELS = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid' }

export function categoryLabel(id, custom = []) {
  return TIME_OFF_LABELS[id] || custom.find(c => c.id === id)?.label || id
}

// ---- Windows ----------------------------------------------------------------

// A window is a start and end time on one day. An end at or before its start
// runs into the next morning, as with overnight shifts.
function resolveWindow(w) {
  const start = parseTime(normalizeTimeInput(w?.start || '') || '')
  const end = parseTime(normalizeTimeInput(w?.end || '') || '')
  if (start === null || end === null) return null
  if (start === end) return null
  return { start: formatClock(start), end: formatClock(end) }
}

function windowMinutes(w) {
  const start = parseTime(w.start)
  let end = parseTime(w.end)
  if (end <= start) end += DAY_MINUTES
  return { start, end }
}

// ---- Weekly pattern ---------------------------------------------------------

// Checks and normalises a weekly pattern as submitted. Every day ends up
// explicit: available with one or two windows, or not available.
export function validateWeekly(input) {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Set your availability for each day.' }
  const weekly = {}
  for (const [i, day] of DAY_KEYS.entries()) {
    const d = input[day]
    if (!d || d.available === false) {
      weekly[day] = { available: false, windows: [] }
      continue
    }
    const raw = Array.isArray(d.windows) && d.windows.length ? d.windows : [{ start: '00:00', end: '00:00' }]
    if (raw.length > MAX_WINDOWS_PER_DAY) return { ok: false, message: `Use at most ${MAX_WINDOWS_PER_DAY} time windows a day.` }
    // "All day" is a window from midnight to midnight.
    const allDay = raw.length === 1 && raw[0].start === '00:00' && raw[0].end === '00:00'
    const windows = allDay ? [{ start: '00:00', end: '00:00' }] : raw.map(resolveWindow)
    if (windows.some(w => !w)) return { ok: false, message: `${DAY_SHORT[i]}: enter times like 9:00 and 17:00.` }
    if (windows.length === 2) {
      const [a, b] = windows.map(windowMinutes)
      if (a.start < b.end && b.start < a.end) return { ok: false, message: `${DAY_SHORT[i]}: the two windows overlap.` }
    }
    weekly[day] = { available: true, windows }
  }
  return { ok: true, value: weekly }
}

export function isAllDay(day) {
  return day?.available && day.windows.length === 1 && day.windows[0].start === '00:00' && day.windows[0].end === '00:00'
}

// ---- Effective dates --------------------------------------------------------

// The weekly pattern in force on `date`. Availability keeps a short list of
// versions, each from its effective date, so a change can be entered now and
// apply from next month.
export function versionOn(availability, date) {
  const versions = (availability?.versions || []).filter(v => v.effectiveFrom <= date)
  return versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1) || null
}

export function upcomingVersion(availability, today) {
  return (availability?.versions || []).filter(v => v.effectiveFrom > today)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] || null
}

// Adds a version, replacing one with the same date, and drops versions that
// can never apply again: anything older than the one in force today.
export function withVersion(versions = [], next, today) {
  const kept = versions.filter(v => v.effectiveFrom !== next.effectiveFrom)
  const all = [...kept, next].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  const current = all.filter(v => v.effectiveFrom <= today).at(-1)
  return all.filter(v => !current || v.effectiveFrom >= current.effectiveFrom)
}

// ---- Temporary changes ------------------------------------------------------

export function validateOverride(input, today) {
  if (!isDateString(input?.from) || !isDateString(input?.to)) return { ok: false, message: 'Choose the dates.' }
  if (input.to < input.from) return { ok: false, message: 'The end date is before the start date.' }
  if (input.to < today) return { ok: false, message: 'Those dates have already passed.' }
  if (daysBetween(input.from, input.to) > MAX_TIME_OFF_DAYS) return { ok: false, message: `Keep it under ${MAX_TIME_OFF_DAYS} days.` }
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 140) : ''
  if (input.unavailable !== false) return { ok: true, value: { from: input.from, to: input.to, unavailable: true, windows: [], reason } }
  const w = resolveWindow(input.window)
  if (!w) return { ok: false, message: 'Enter the hours you can work, like 9:00 to 13:00.' }
  return { ok: true, value: { from: input.from, to: input.to, unavailable: false, windows: [w], reason } }
}

// ---- What a day looks like --------------------------------------------------

// A person's availability on one date: a temporary change if one covers it,
// otherwise their weekly pattern. Null when they have never said, which is
// read as no restriction.
export function availabilityOn(availability, date) {
  if (!availability) return null
  const override = (availability.overrides || []).find(o => o.from <= date && o.to >= date)
  if (override) {
    return { available: !override.unavailable, windows: override.windows || [], source: 'override', reason: override.reason || '' }
  }
  const version = versionOn(availability, date)
  if (!version) return null
  const day = version.weekly?.[DAY_KEYS[weekdayIndex(date)]]
  if (!day) return null
  return { available: day.available, windows: day.windows || [], source: 'weekly' }
}

// Whether a shift sits inside what the person said they can work. Returns
// null when it fits, or a reason.
export function availabilityProblem(shift, availability) {
  const day = availabilityOn(availability, shift.date)
  if (!day) return null
  const label = formatDateShort(shift.date)
  if (!day.available) {
    return day.source === 'override' ? `marked ${label} as unavailable${day.reason ? ` (${day.reason})` : ''}` : `is not available on ${DAY_SHORT[weekdayIndex(shift.date)]}s`
  }
  if (isAllDay({ available: true, windows: day.windows })) return null
  const s = parseTime(shift.startLocal)
  let e = parseTime(shift.endLocal)
  if (e <= s) e += DAY_MINUTES
  const fits = day.windows.map(windowMinutes).some(w => s >= w.start && e <= w.end)
  if (fits) return null
  return `is available ${day.windows.map(w => `${formatTime12(parseTime(w.start))}–${formatTime12(parseTime(w.end))}`).join(' and ')} on ${label}`
}

// "Mon–Fri 9am–5pm · Sat 10am–2pm". Consecutive days with the same hours are
// grouped; days off are left out.
export function summarizeWeekly(weekly) {
  if (!weekly) return 'Not set'
  const describe = (d) => !d?.available ? null : isAllDay(d) ? 'all day'
    : d.windows.map(w => `${formatTime12(parseTime(w.start))}–${formatTime12(parseTime(w.end))}`).join(', ')
  const groups = []
  DAY_KEYS.forEach((key, i) => {
    const text = describe(weekly[key])
    const last = groups.at(-1)
    if (text && last && last.text === text && last.end === i - 1) last.end = i
    else if (text) groups.push({ start: i, end: i, text })
  })
  if (!groups.length) return 'Not available any day'
  return groups.map(g => `${g.start === g.end ? DAY_SHORT[g.start] : `${DAY_SHORT[g.start]}–${DAY_SHORT[g.end]}`} ${g.text}`).join(' · ')
}

// ---- Time off ---------------------------------------------------------------

// Checks a request as submitted. A partial day carries times and must be a
// single date.
export function validateTimeOff(input, { today, categories }) {
  if (!categories.includes(input?.category)) return { ok: false, message: 'Choose what kind of time off this is.' }
  if (!isDateString(input.startDate) || !isDateString(input.endDate)) return { ok: false, message: 'Choose the dates.' }
  if (input.endDate < input.startDate) return { ok: false, message: 'The last day is before the first day.' }
  if (input.startDate < today) return { ok: false, message: 'Time off has to start today or later.' }
  if (daysBetween(input.startDate, input.endDate) >= MAX_TIME_OFF_DAYS) return { ok: false, message: `Requests can cover at most ${MAX_TIME_OFF_DAYS} days.` }
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 280) : ''
  let partial = null
  if (input.partialStart || input.partialEnd) {
    if (input.startDate !== input.endDate) return { ok: false, message: 'Part-day time off is for a single day.' }
    const w = resolveWindow({ start: input.partialStart, end: input.partialEnd })
    if (!w) return { ok: false, message: 'Enter the hours you need off, like 13:00 to 17:00.' }
    partial = w
  }
  return { ok: true, value: { category: input.category, startDate: input.startDate, endDate: input.endDate, partial, reason } }
}

export function timeOffDays(request) {
  return daysBetween(request.startDate, request.endDate) + 1
}

export function describeTimeOff(request) {
  const range = request.startDate === request.endDate
    ? formatDateShort(request.startDate)
    : `${formatDateShort(request.startDate)} – ${formatDateShort(request.endDate)}`
  if (!request.partial) return `${range}${request.startDate === request.endDate ? '' : ` · ${timeOffDays(request)} days`}`
  return `${range}, ${formatTime12(parseTime(request.partial.start))}–${formatTime12(parseTime(request.partial.end))}`
}

// The local window a request covers on one date, in minutes on that date's
// timeline, or null if it does not touch that date.
export function timeOffWindowOn(request, date) {
  if (date < request.startDate || date > request.endDate) return null
  if (!request.partial) return { start: 0, end: DAY_MINUTES }
  return windowMinutes(request.partial)
}

// Whether a shift falls in time off. Compares local times on the shift's own
// date, and for an overnight shift the morning after.
export function timeOffClash(shift, request) {
  const s = parseTime(shift.startLocal)
  let e = parseTime(shift.endLocal)
  if (e <= s) e += DAY_MINUTES
  const today = timeOffWindowOn(request, shift.date)
  if (today && s < today.end && today.start < e) return true
  if (e > DAY_MINUTES) {
    const next = timeOffWindowOn(request, addDays(shift.date, 1))
    if (next && next.start < e - DAY_MINUTES) return true
  }
  return false
}
