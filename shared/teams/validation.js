// Whether a person can take on a shift, and if not, why. Used before every
// pickup and swap: when someone asks (so they see the reason up front), and
// again inside the approving transaction (so nothing changed in between).
//
// Pure: the caller gathers the facts and this decides. The same function runs
// on the server, which is authoritative, and in tests.

import { DEFAULT_POLICIES } from './schema.js'
import { timeOffClash } from './availability.js'
import { addDays, formatDateShort, formatDuration, formatShiftRange, weekStartOf } from './time.js'

const HOUR = 60 * 60 * 1000

// Problems are written for the person who will read them. `audience` decides
// how much is said about the other workplace: the person themselves may hear
// it is another of their jobs; a manager hears only that there is a clash.
export function checkAssignment({
  shift,
  person,
  sameBusinessShifts = [],
  otherWorkplaceBlocks = [],
  timeOff = [],
  policies = DEFAULT_POLICIES,
  now = new Date(),
  audience = 'self',
  excludeShiftIds = [],
}) {
  const problems = []
  const who = audience === 'self' ? 'You' : person.name
  const p = { ...DEFAULT_POLICIES, ...policies }
  const add = (code, message) => problems.push({ code, message })

  if (!person.active) add('not_member', `${person.name} is no longer part of this workplace.`)
  if (!person.uid) add('no_account', `${person.name} has not joined Hengam Teams yet.`)

  const startAt = new Date(shift.startAt)
  const endAt = new Date(shift.endAt)
  if (startAt <= now) add('started', 'This shift has already started.')
  else if (p.offerCutoffHours && startAt - now < p.offerCutoffHours * HOUR) {
    add('too_late', `Changes close ${p.offerCutoffHours} ${p.offerCutoffHours === 1 ? 'hour' : 'hours'} before a shift starts.`)
  }

  // Position: only when the shift names one and the person has a list of
  // positions they work. A roster entry with no positions can work any.
  if (p.requirePositionMatch && shift.positionName && person.positionNames?.length) {
    const wanted = shift.positionName.toLowerCase()
    if (!person.positionNames.some(n => String(n).toLowerCase() === wanted)) {
      add('position', `${who} ${audience === 'self' ? 'are' : 'is'} not set up to work as ${shift.positionName}.`)
    }
  }
  if (p.requireLocationMatch && shift.locationId && person.locationIds?.length && !person.locationIds.includes(shift.locationId)) {
    add('location', `${who} ${audience === 'self' ? 'do' : 'does'} not work at this location.`)
  }

  const ignore = new Set([shift.id, ...excludeShiftIds])
  const mine = sameBusinessShifts
    .filter(s => !ignore.has(s.id) && s.status !== 'cancelled')
    .map(s => ({ ...s, startAt: new Date(s.startAt), endAt: new Date(s.endAt) }))
  const elsewhere = otherWorkplaceBlocks
    .filter(b => !ignore.has(b.shiftId))
    .map(b => ({ ...b, startAt: new Date(b.startAt), endAt: new Date(b.endAt) }))

  const clash = mine.find(s => s.startAt < endAt && startAt < s.endAt)
  if (clash) add('conflict', `${who} already ${audience === 'self' ? 'work' : 'works'} ${formatShiftRange(clash)} on ${formatDateShort(clash.date)}.`)
  const away = elsewhere.find(b => b.startAt < endAt && startAt < b.endAt)
  if (away) {
    add('conflict_elsewhere', audience === 'self'
      ? 'You have a shift at another workplace at the same time.'
      : `${person.name} has another commitment at that time.`)
  }

  // Time off a manager has approved. Someone who asked for the day off is
  // not handed a shift on it, even by their own request.
  if (timeOff.some(r => r.status === 'approved' && timeOffClash(shift, r))) {
    add('time_off', audience === 'self' ? 'You have approved time off then.' : `${person.name} has approved time off then.`)
  }

  if (p.minRestHours) {
    const minRest = p.minRestHours * HOUR
    const tooClose = [...mine, ...elsewhere].find(s =>
      (s.endAt <= startAt && startAt - s.endAt < minRest) || (s.startAt >= endAt && s.startAt - endAt < minRest))
    if (tooClose && !(clash || away)) {
      add('rest', `${who} would have less than ${p.minRestHours} hours of rest between shifts.`)
    }
  }

  const minutesOn = (filter) => mine.filter(filter).reduce((sum, s) => sum + (s.minutes || 0), 0)
  if (p.maxHoursPerDay) {
    const total = minutesOn(s => s.date === shift.date) + shift.minutes
    if (total > p.maxHoursPerDay * 60) {
      add('max_day', `This would make ${formatDuration(total)} on ${formatDateShort(shift.date)}, over the ${p.maxHoursPerDay}-hour daily limit.`)
    }
  }
  if (p.maxHoursPerWeek) {
    const weekStart = weekStartOf(shift.date)
    const weekEnd = addDays(weekStart, 6)
    const total = minutesOn(s => s.date >= weekStart && s.date <= weekEnd) + shift.minutes
    if (total > p.maxHoursPerWeek * 60) {
      add('max_week', `This would make ${formatDuration(total)} that week, over the ${p.maxHoursPerWeek}-hour weekly limit.`)
    }
  }

  return { ok: problems.length === 0, problems }
}

// The window of a person's other shifts a check needs to see: the whole
// business-local week for the weekly limit, padded for rest and overnights.
export function validationWindow(shiftDate) {
  const weekStart = weekStartOf(shiftDate)
  return { fromDate: addDays(weekStart, -2), toDate: addDays(weekStart, 9) }
}

export function describeProblems(problems) {
  return problems.map(p => p.message).join(' ')
}
