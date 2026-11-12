// Checks a week against the workspace's coverage, people's availability and
// time off, and the rules parsed for it. Used when a week is generated and
// again after every manual edit, so a saved week's review items always
// describe the shifts saved with them (HQA-09). Pure: no Firestore.

import { fromMinutes, shiftLengthHours, toMinutes } from './shiftTime.js'
import { dateForDay, isMonday as isMondayDate } from './weekDates.js'

const DAY_MINUTES = 24 * 60
const shiftHours = (start, end) => shiftLengthHours(start, end)
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const shiftStartMins = (shift) => toMinutes(shift.start)
const shiftEndMins = (shift) => { const m = toMinutes(shift.end); return m === 0 ? DAY_MINUTES : m }
function shiftsOverlap(a, b) {
  return shiftStartMins(a) < shiftEndMins(b) && shiftEndMins(a) > shiftStartMins(b)
}

function onTimeOff(emp, date) {
  return (emp.timeOff || []).some(to => to?.start && to?.end && to.start <= date && date <= to.end)
}

/**
 * Stretches of an open day with fewer than `minPeople` on shift, as minutes
 * from the start of that day ({ from, to, count }). Days that trade past
 * midnight run on a timeline beyond 24:00, as shifts do.
 */
export function coverageGaps(shifts, opDay, minPeople) {
  const opStart = toMinutes(opDay.start)
  let opEnd = toMinutes(opDay.end) || DAY_MINUTES
  if (opEnd <= opStart) opEnd += DAY_MINUTES
  const spans = shifts.map(s => {
    let a = toMinutes(s.start)
    let b = toMinutes(s.end) || DAY_MINUTES
    if (b <= a) b += DAY_MINUTES
    if (opEnd > DAY_MINUTES && b <= opStart) { a += DAY_MINUTES; b += DAY_MINUTES }
    return [a, b]
  })
  const points = [...new Set([opStart, opEnd, ...spans.flat()])].filter(p => p >= opStart && p <= opEnd).sort((x, y) => x - y)
  const gaps = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i], to = points[i + 1]
    const count = spans.filter(([a, b]) => a <= from && b >= to).length
    if (count >= minPeople) continue
    const last = gaps[gaps.length - 1]
    if (last && last.to === from && last.count === count) last.to = to
    else gaps.push({ from, to, count })
  }
  return gaps
}

// JS validator — checks hard rules and structured scheduling rules.
// Never makes scheduling decisions. Returns violation strings for the AI to fix.
export function validateSchedule(data, employees, parsedRules = null, workspace = {}) {
  const violations = []
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const empMap = Object.fromEntries(employees.map(e => [e.name, e]))
  const weekTotals = {}
  const toM = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0) }
  const coverageRules = parsedRules?.coverage || null
  const employeeRules = parsedRules?.employeeRules || null

  // --- Workspace per-day minimums, across the whole open day. Counting the
  // shifts on a day is not enough: two people where one starts an hour late
  // still leaves that hour short (HQA-09). Each short stretch is reported
  // with its times. ---
  if (workspace.coverage && workspace.operatingHours) {
    DAYS.forEach(day => {
      const opDay = workspace.operatingHours[day]
      const minPeople = Number(workspace.coverage[day]?.minPeople) || 0
      if (!opDay?.open || minPeople < 1) return
      coverageGaps(data.days?.[day]?.shifts || [], opDay, minPeople).forEach(gap => {
        violations.push(`${capitalize(day)}: needs ${minPeople} staff from ${fromMinutes(gap.from)}–${fromMinutes(gap.to)} — only ${gap.count} on shift`)
      })
    })
  }

  // --- Approved time off on the calendar date of each day. ---
  DAYS.forEach((day, i) => {
    const date = data.days?.[day]?.date || (isMondayDate(data.weekStart) ? dateForDay(data.weekStart, i) : '')
    if (!date) return
    ;(data.days?.[day]?.shifts || []).forEach(shift => {
      const emp = empMap[shift.employee]
      if (emp && onTimeOff(emp, date)) violations.push(`${capitalize(day)}: ${shift.employee} has approved time off on ${date}`)
    })
  })

  DAYS.forEach(day => {
    const dayData = data.days?.[day]
    if (!dayData?.shifts?.length) return

    const shifts = dayData.shifts
    const seenToday = new Set()

    // --- Per-shift hard rules ---
    shifts.forEach(shift => {
      const emp = empMap[shift.employee]

      if (!emp) {
        violations.push(`${capitalize(day)}: "${shift.employee}" is not a known employee`)
        return
      }

      if (seenToday.has(shift.employee)) {
        violations.push(`${capitalize(day)}: ${shift.employee} is scheduled twice on the same day`)
      }
      seenToday.add(shift.employee)

      if (emp.role && shift.role !== emp.role) {
        violations.push(`${capitalize(day)}: ${shift.employee}'s role is "${emp.role}" — do not change it to "${shift.role}"`)
      }

      const av = emp.availability?.[day]
      if (!av || av.available === false) {
        violations.push(`${capitalize(day)}: ${shift.employee} is not available`)
      } else if (av.start && av.end) {
        const ss = toM(shift.start), se = toM(shift.end)
        // On a day that trades past midnight both the shift and the
        // availability sit on a timeline that runs beyond 24:00.
        const opDay = workspace.operatingHours?.[day]
        const opStart = opDay ? toM(opDay.start) : 0
        let opEnd = opDay ? (toM(opDay.end) || 24 * 60) : 24 * 60
        if (opEnd <= opStart) opEnd += 24 * 60
        let as = toM(av.start)
        let ae = toM(av.end) || 24 * 60
        if (ae <= as) ae += 24 * 60
        if (opEnd > 24 * 60 && ae <= opStart) { as += 24 * 60; ae += 24 * 60 }
        if (ss < as || se > ae) {
          violations.push(`${capitalize(day)}: ${shift.employee} shift ${shift.start}–${shift.end} is outside availability ${av.start}–${av.end}`)
        }
      }

      const hours = Number(shift.hours) || shiftHours(shift.start, shift.end)
      if (hours < 4) violations.push(`${capitalize(day)}: ${shift.employee} shift is ${hours}h — minimum is 4h`)
      if (hours > 8.5) violations.push(`${capitalize(day)}: ${shift.employee} shift is ${hours}h — maximum is 8.5h`)

      weekTotals[shift.employee] = (weekTotals[shift.employee] || 0) + hours
    })

    // --- Coverage rules (structural, from AI-parsed workspace rules) ---
    if (coverageRules) {
      const { openers, closers, preCloser, alwaysPresent, minimumStaff } = coverageRules

      if (openers) {
        const byMins = toM(openers.by)
        const openerShifts = shifts.filter(s => toM(s.start) <= byMins)
        if (openers.composition?.length) {
          openers.composition.forEach(({ role, count }) => {
            const found = openerShifts.filter(s => s.role === role).length
            if (found < count) {
              violations.push(`${capitalize(day)}: opening (by ${openers.by}) needs at least ${count} ${role}(s) — only ${found} found`)
            }
          })
        } else if (openers.count != null) {
          const found = openerShifts.filter(s => !openers.roles?.length || openers.roles.includes(s.role)).length
          if (found < openers.count) violations.push(`${capitalize(day)}: needs at least ${openers.count} opener(s) by ${openers.by} — only ${found} found`)
        }
      }

      if (closers) {
        const endMins = toM(closers.shiftEnd)
        const closerShifts = shifts.filter(s => toM(s.end) >= endMins)
        if (closers.composition?.length) {
          closers.composition.forEach(({ role, count }) => {
            const found = closerShifts.filter(s => s.role === role).length
            if (found < count) {
              violations.push(`${capitalize(day)}: closing (at ${closers.shiftEnd}) needs at least ${count} ${role}(s) — only ${found} found`)
            }
          })
        } else if (closers.count != null) {
          const found = closerShifts.filter(s => !closers.roles?.length || closers.roles.includes(s.role)).length
          if (found < closers.count) violations.push(`${capitalize(day)}: needs ${closers.count} closer(s) ending at or after ${closers.shiftEnd} — only ${found} found`)
        }
      }

      if (preCloser) {
        const targetMins = toM(preCloser.shiftEnd)
        const found = shifts.filter(s =>
          Math.abs(toM(s.end) - targetMins) <= 30 &&
          (!preCloser.roles?.length || preCloser.roles.includes(s.role))
        ).length
        if (found < preCloser.count) {
          violations.push(`${capitalize(day)}: needs ${preCloser.count} pre-closer(s) ending around ${preCloser.shiftEnd}${preCloser.roles?.length ? ` (${preCloser.roles.join(' or ')})` : ''} — only ${found} found`)
        }
      }

      if (alwaysPresent?.length) {
        alwaysPresent.forEach(role => {
          if (!shifts.some(s => s.role === role)) {
            violations.push(`${capitalize(day)}: ${role} must always be present — none scheduled`)
          }
        })
      }

      if (minimumStaff?.length) {
        minimumStaff.forEach(({ from, to, count }) => {
          const fromMins = toM(from), toMins = toM(to)
          const active = shifts.filter(s => toM(s.start) < toMins && toM(s.end) > fromMins).length
          if (active < count) {
            violations.push(`${capitalize(day)}: needs ${count} staff from ${from}–${to} — only ${active} on shift`)
          }
        })
      }
    }

    if (employeeRules) {
      ;(employeeRules.pairTogether || []).forEach(([a, b]) => {
        const aShifts = shifts.filter(s => s.employee === a)
        const bShifts = shifts.filter(s => s.employee === b)
        if (aShifts.length !== bShifts.length || (aShifts.length > 0 && bShifts.length === 0)) {
          violations.push(`${capitalize(day)}: ${a} and ${b} must be scheduled together`)
        } else if (aShifts.length && !aShifts.some(aShift => bShifts.some(bShift => shiftsOverlap(aShift, bShift)))) {
          violations.push(`${capitalize(day)}: ${a} and ${b} are both scheduled but their shifts do not overlap`)
        }
      })

      ;(employeeRules.avoidTogether || []).forEach(([a, b]) => {
        const aShifts = shifts.filter(s => s.employee === a)
        const bShifts = shifts.filter(s => s.employee === b)
        if (aShifts.some(aShift => bShifts.some(bShift => shiftsOverlap(aShift, bShift)))) {
          violations.push(`${capitalize(day)}: ${a} and ${b} must not work the same shift`)
        }
      })

      Object.entries(employeeRules.shiftHoursByEmployee || {}).forEach(([employee, expectedHours]) => {
        shifts
          .filter(s => s.employee === employee)
          .forEach(shift => {
            const actualHours = Number(shift.hours) || shiftHours(shift.start, shift.end)
            if (Math.abs(actualHours - Number(expectedHours)) > 0.05) {
              violations.push(`${capitalize(day)}: ${employee} should have ${expectedHours}h shifts — scheduled ${actualHours}h`)
            }
          })
      })
    }
  })

  if (employeeRules) {
    Object.entries(employeeRules.maxDays || {}).forEach(([employee, max]) => {
      const days = DAYS.filter(day =>
        (data.days?.[day]?.shifts || []).some(shift => shift.employee === employee)
      ).length
      if (days > Number(max)) {
        violations.push(`${employee}: scheduled ${days} days but maximum is ${max}`)
      }
    })

    Object.entries(employeeRules.maxCloses || {}).forEach(([employee, max]) => {
      const closes = DAYS.filter(day => {
        const shifts = data.days?.[day]?.shifts || []
        const latestEnd = shifts.reduce((latest, shift) => Math.max(latest, toM(shift.end)), 0)
        return shifts.some(shift => shift.employee === employee && toM(shift.end) >= latestEnd - 30)
      }).length
      if (closes > Number(max)) {
        violations.push(`${employee}: scheduled ${closes} closing shifts but maximum is ${max}`)
      }
    })
  }

  // --- Weekly target check (over AND under) ---
  employees.forEach(emp => {
    if (emp.targetHours == null) return
    const total = Math.round((weekTotals[emp.name] || 0) * 10) / 10
    const diff = Math.round((total - emp.targetHours) * 10) / 10

    if (diff > 0.05) {
      violations.push(`${emp.name}: scheduled ${total}h but target is ${emp.targetHours}h — ${diff}h over`)
    } else if (diff < -1) {
      // Find days they're available but not yet scheduled
      const openDays = DAYS.filter((d, i) => {
        const av = emp.availability?.[d]
        if (!av || av.available === false) return false
        // A day blocked by approved time off is not spare availability (HQA-12).
        const date = data.days?.[d]?.date || (isMondayDate(data.weekStart) ? dateForDay(data.weekStart, i) : '')
        if (date && onTimeOff(emp, date)) return false
        return !(data.days?.[d]?.shifts || []).some(s => s.employee === emp.name)
      })
      if (openDays.length > 0) {
        violations.push(`${emp.name}: only ${total}h scheduled but target is ${emp.targetHours}h — add shifts on: ${openDays.map(capitalize).join(', ')}`)
      } else {
        violations.push(`${emp.name}: only ${total}h scheduled but target is ${emp.targetHours}h — no unused available days remain`)
      }
    }
  })

  return violations
}

export function calculateScheduleSummary(schedule, employees) {
  const totals = {}

  Object.values(schedule?.days || {}).forEach(day => {
    ;(day.shifts || []).forEach(shift => {
      const hours = Number(shift.hours) || shiftHours(shift.start, shift.end)
      totals[shift.employee] = (totals[shift.employee] || 0) + hours
    })
  })

  const employeeRows = employees.map(emp => {
    const scheduled = Math.round((totals[emp.name] || 0) * 10) / 10
    const target = Number(emp.targetHours) || 0
    delete totals[emp.name]
    return {
      employee: emp.name,
      role: emp.role || '',
      scheduledHours: scheduled,
      targetHours: target,
      difference: Math.round((scheduled - target) * 10) / 10,
    }
  })

  const unknownRows = Object.entries(totals).map(([employee, total]) => {
    const scheduled = Math.round(total * 10) / 10
    return {
      employee,
      role: '',
      scheduledHours: scheduled,
      targetHours: 0,
      difference: scheduled,
    }
  })

  return [...employeeRows, ...unknownRows]
}


/**
 * A week after a manual edit: summary and review items recomputed from the
 * shifts it now holds. The rules parsed when it was generated travel with
 * the week (data.checkedRules); older weeks saved without them keep their
 * earlier review items as well, so a rule problem is never silently dropped.
 * AI suggestions written for the earlier review items are dropped when those
 * items change, since they no longer describe the week.
 */
export function revalidateSchedule(data, employees, workspace = {}) {
  if (!data?.days) return data
  const hasRules = Object.prototype.hasOwnProperty.call(data, 'checkedRules')
  const fresh = validateSchedule(data, employees, hasRules ? data.checkedRules : null, workspace)
  const issues = hasRules ? fresh : [...new Set([...fresh, ...(data.issues || [])])]
  const before = JSON.stringify(data.issues || [])
  const changed = before !== JSON.stringify(issues)
  return {
    ...data,
    summary: calculateScheduleSummary(data, employees),
    issues,
    recommendations: changed ? [] : (data.recommendations || []),
    checkedAt: new Date().toISOString(),
  }
}
