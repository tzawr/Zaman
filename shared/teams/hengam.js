// Translation between Hengam's data and Teams'. Pure functions only; the
// server reads and writes, these decide what the other side should look like.
//
// Who owns what:
//   Hengam owns the roster and the schedule. Publishing from Hengam copies a
//     week into Teams; Teams never edits a Hengam schedule except to record a
//     transfer people agreed to in Teams.
//   Teams owns availability and time off. Hengam's generator reads them,
//     converted to its own shapes, when the workspace is connected.

import { availabilityOn } from './availability.js'
import { DAY_MINUTES, addDays, formatClock, parseTime } from './time.js'

export const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

// One Teams business per Hengam workspace, with an id derived from the
// manager's account, so connecting twice finds the same business.
export function hengamBusinessId(managerUid) {
  return `hengam-${managerUid}`
}

// A Teams shift id for a slot in a Hengam week: the day, and the shift's
// position in that day's list. Republishing the same week updates the same
// documents, and a transfer recorded in Teams keeps its shift.
export function hengamShiftId(weekStart, dayKey, index) {
  return `h_${weekStart}_${dayKey}_${index}`
}

// Hengam writes an overnight end as 26:00. Teams takes wall-clock times and
// infers the next morning from an end before the start.
export function hengamTimesToWall(start, end) {
  const s = parseTime(start)
  const e = typeof end === 'string' ? end.split(':').map(Number) : []
  if (s === null || e.length !== 2 || !Number.isFinite(e[0]) || !Number.isFinite(e[1])) return null
  const endMinutes = e[0] * 60 + e[1]
  if (endMinutes > 2 * DAY_MINUTES) return null
  return { start: formatClock(s), end: formatClock(endMinutes % DAY_MINUTES) }
}

// The shifts a Hengam schedule describes, keyed to Teams ids and to the
// Hengam employees by id. Hengam's shifts name employees by name, so a name
// that matches nobody, or more than one person, stops the publish with a
// reason rather than guessing.
export function desiredShiftsFromHengam({ scheduleId, weekStart, data, employees }) {
  const byName = new Map()
  for (const e of employees) {
    const key = String(e.name || '').trim().toLowerCase()
    if (!key) continue
    byName.set(key, byName.has(key) ? null : e)
  }
  const errors = []
  const shifts = []
  DAY_KEYS.forEach((dayKey, i) => {
    const day = data?.days?.[dayKey]
    const date = day?.date || addDays(weekStart, i)
    ;(day?.shifts || []).forEach((s, index) => {
      const key = String(s?.employee || '').trim().toLowerCase()
      const match = byName.get(key)
      if (match === undefined) { errors.push(`No employee named “${s?.employee}” for ${dayKey}.`); return }
      if (match === null) { errors.push(`Two employees are called “${s.employee}”. Rename one so shifts can be matched.`); return }
      const times = hengamTimesToWall(s.start, s.end)
      if (!times) { errors.push(`A ${dayKey} shift for ${s.employee} has times that cannot be read.`); return }
      shifts.push({
        id: hengamShiftId(weekStart, dayKey, index),
        staffId: match.id,
        staffName: match.name,
        positionName: s.role ? String(s.role).slice(0, 40) : null,
        date,
        start: times.start,
        end: times.end,
        hengamRef: { scheduleId, day: dayKey, index },
      })
    })
  })
  return { errors: [...new Set(errors)], shifts }
}

// Whether a Teams shift needs rewriting to match its Hengam slot. A change
// of Hengam schedule version alone (same person, same times) does not.
export function shiftDiffers(existing, desired, resolved) {
  return existing.staffId !== desired.staffId
    || existing.date !== resolved.date
    || existing.startLocal !== resolved.startLocal
    || existing.endLocal !== resolved.endLocal
    || (existing.positionName || null) !== (desired.positionName || null)
    || existing.status === 'cancelled'
}

// A stable fingerprint of what a publish would produce, recorded on the Teams
// schedule so an unchanged republish is recognised and skipped.
export function publishFingerprint(shifts) {
  return shifts.map(s => `${s.id}|${s.staffId}|${s.date}|${s.start}|${s.end}|${s.positionName || ''}`).sort().join('\n')
}

// ---- Teams → Hengam ---------------------------------------------------------

// Hengam's availability for one week from Teams availability, day by day, so
// temporary changes and a change effective mid-week land on the right days.
// Hengam holds one window a day: two Teams windows become one spanning both.
// An all-day day has no times, which Hengam reads as its opening hours.
export function hengamAvailabilityForWeek(teamsAvailability, weekStart) {
  if (!teamsAvailability) return null
  const result = {}
  let known = false
  DAY_KEYS.forEach((dayKey, i) => {
    const day = availabilityOn(teamsAvailability, addDays(weekStart, i))
    if (!day) return
    known = true
    if (!day.available) { result[dayKey] = { available: false }; return }
    const allDay = day.windows.length === 1 && day.windows[0].start === '00:00' && day.windows[0].end === '00:00'
    if (!day.windows.length || allDay) { result[dayKey] = { available: true }; return }
    result[dayKey] = { available: true, start: day.windows[0].start, end: day.windows.at(-1).end }
  })
  return known ? result : null
}

// Hengam's time off from approved Teams requests. Hengam has whole days only,
// so a part-day request keeps the person off that whole day: generating a
// schedule around it must not put them in the hours they asked off.
export function hengamTimeOff(teamsRequests) {
  return (teamsRequests || [])
    .filter(r => r.status === 'approved')
    .map(r => ({ id: `teams-${r.id}`, start: r.startDate, end: r.endDate, reason: r.reason || 'Time off', source: 'teams' }))
}

// For a Hengam generation: the Teams view of each employee, where they have
// one, replacing what the Hengam record holds. Teams is the source of truth
// for availability and time off once the workspace is connected.
export function applyTeamsToHengamEmployees(employees, { availabilityByStaffId, timeOffByStaffId, weekStart }) {
  return employees.map(emp => {
    const availability = hengamAvailabilityForWeek(availabilityByStaffId[emp.id], weekStart)
    const teamsOff = hengamTimeOff(timeOffByStaffId[emp.id])
    if (!availability && !teamsOff.length) return emp
    return {
      ...emp,
      ...(availability ? { availability, availabilitySource: 'teams' } : {}),
      timeOff: [...(emp.timeOff || []).filter(t => t.source !== 'teams'), ...teamsOff],
    }
  })
}

// Whether a Hengam slot still holds the shift a Teams transfer was agreed on.
// If the manager has changed the week in Hengam since publishing, the
// transfer is refused rather than written over their edit.
export function hengamSlotMatches(slot, shift) {
  if (!slot) return false
  const times = hengamTimesToWall(slot.start, slot.end)
  return Boolean(times)
    && String(slot.employee || '').trim().toLowerCase() === String(shift.staffName || '').trim().toLowerCase()
    && times.start === shift.startLocal
    && times.end === shift.endLocal
}
