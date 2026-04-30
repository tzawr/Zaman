const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_ABBR = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']

function timeToMins(hhmm, asClose = false) {
  if (!hhmm) return asClose ? 24 * 60 : 0
  const [h, m] = hhmm.split(':').map(Number)
  const mins = h * 60 + (m || 0)
  return asClose && mins === 0 ? 24 * 60 : mins
}

function minsToTime(mins) {
  mins = Math.max(0, Math.min(mins, 24 * 60))
  if (mins === 24 * 60) return '24:00'
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

function snapHalf(mins) {
  return Math.round(mins / 30) * 30
}

function getDateForDay(weekStart, idx) {
  const d = new Date(weekStart + 'T12:00:00')
  d.setDate(d.getDate() + idx)
  return d.toISOString().split('T')[0]
}

function isTimeOffDate(emp, date) {
  if (!emp.timeOff?.length) return false
  const day = new Date(date + 'T12:00:00').getTime()
  return emp.timeOff.some(to => {
    const s = new Date(to.start + 'T00:00:00').getTime()
    const e = new Date(to.end + 'T00:00:00').getTime() + 86399000
    return day >= s && day <= e
  })
}

// constraints shape:
// {
//   slots: [{start, end, role, count, days}],
//   pairs: [["Alice", "Jordan"]],
//   prioritize: {monday: ["Sam"]},
//   avoid: [["Rae", "Kota"]],
//   maxDays: { "Nura": 5 },
//   maxCloses: { "Nura": 2 },
//   preferWindows: { "Isabel": { start: "04:00", end: "12:00" } },
//   shiftHoursByEmployee: { "Amir": 4 },
//   trainingPairs: [{ trainee: "New Hire", mentorRole: "Shift Supervisor" }],
//   minimumStaff: [{from, to, count}],
// }

function computeShift(emp, dayKey, slotStartMins, slotEndMins, opStartMins, opEndMins, totals, dayIdx, idx, dailyBudget, preferWindows, anchor = 'start', options = {}) {
  const av = emp.availability[dayKey]
  const avStart = timeToMins(av.start || minsToTime(opStartMins))
  const avEnd = timeToMins(av.end || minsToTime(opEndMins), true)

  // Apply preferred shift window if set — narrows the slot to match the preference
  // but only when the preferred window is large enough for a 4h shift
  const pref = preferWindows?.[emp.name]
  let effStart = slotStartMins
  let effEnd = slotEndMins
  if (pref) {
    const ps = timeToMins(pref.start)
    const pe = timeToMins(pref.end, true)
    const ns = Math.max(slotStartMins, ps)
    const ne = Math.min(slotEndMins, pe)
    if (ne - ns >= 4 * 60) { effStart = ns; effEnd = ne }
  }

  const remaining = options.allowOverTarget
    ? 8.5
    : emp.targetHours != null
      ? emp.targetHours - (totals[emp.name] || 0)
      : 8.5
  const budget = options.allowOverTarget
    ? 8.5
    : emp.targetHours != null
      ? (dailyBudget?.[emp.name] ?? remaining)
      : 8.5
  const fixedHours = Number(options.fixedHours) || null
  const todayMaxHours = fixedHours || Math.min(8.5, remaining, budget)
  if (todayMaxHours < 4) return null

  let start
  let end

  if (anchor === 'end') {
    end = snapHalf(Math.min(effEnd, avEnd, opEndMins))
    start = snapHalf(Math.max(effStart, avStart, opStartMins, end - todayMaxHours * 60))
    if (end - start > 8.5 * 60) start = end - 8.5 * 60
  } else {
    start = snapHalf(Math.max(effStart, avStart, opStartMins))
    end = snapHalf(Math.min(effEnd, avEnd, opEndMins, start + todayMaxHours * 60))
    if (end - start > 8.5 * 60) end = start + 8.5 * 60
  }

  if (end - start < 4 * 60) return null

  const hours = Math.round((end - start) / 60 * 10) / 10
  return {
    id: `${DAY_ABBR[dayIdx]}${idx}`,
    employee: emp.name,
    role: emp.role || '',
    start: minsToTime(start),
    end: minsToTime(end),
    hours,
  }
}

function chooseFlexWindow(emp, dayKey, opStartMins, opEndMins, totals, dailyBudget, fixedHours = null) {
  const av = emp.availability?.[dayKey]
  if (!av) return null

  const avStart = timeToMins(av.start || minsToTime(opStartMins))
  const avEnd = timeToMins(av.end || minsToTime(opEndMins), true)
  const remaining = emp.targetHours != null
    ? emp.targetHours - (totals[emp.name] || 0)
    : 8.5
  const budget = emp.targetHours != null ? (dailyBudget?.[emp.name] ?? remaining) : 8.5
  const hours = fixedHours || Math.min(8.5, remaining, budget)
  if (hours < 4) return null

  const duration = hours * 60
  const earliest = Math.max(avStart, opStartMins)
  const latest = Math.min(avEnd, opEndMins) - duration
  if (latest < earliest) return null

  // Flexible, non-coverage shifts should fill the middle/later day instead of
  // all piling onto the opening minute. Coverage slots already handle openers.
  const midpointStart = opStartMins + ((opEndMins - opStartMins) - duration) / 2
  const start = snapHalf(Math.max(earliest, Math.min(latest, midpointStart)))
  return { start, end: start + duration }
}

function dayCapacity(emp, dayKey, operatingHours, dailyBudget, date = null) {
  const av = emp.availability?.[dayKey]
  const opDay = operatingHours?.[dayKey]
  if (!av || av.available === false || !opDay?.open) return 0
  if (date && isTimeOffDate(emp, date)) return 0

  const avStart = timeToMins(av.start || opDay.start)
  const avEnd = timeToMins(av.end || opDay.end, true)
  const opStart = timeToMins(opDay.start)
  const opEnd = timeToMins(opDay.end, true)
  const availableHours = Math.max(0, Math.min(avEnd, opEnd) - Math.max(avStart, opStart)) / 60
  return Math.min(8.5, dailyBudget?.[emp.name] || 8.5, availableHours)
}

function futureCapacity(emp, dayIdx, operatingHours, dailyBudget, weekStart) {
  return DAYS
    .slice(dayIdx + 1)
    .reduce((sum, dayKey, offset) => {
      const futureDayIdx = dayIdx + 1 + offset
      return sum + dayCapacity(emp, dayKey, operatingHours, dailyBudget, getDateForDay(weekStart, futureDayIdx))
    }, 0)
}

function needsFlexShiftToday(emp, dayIdx, operatingHours, totals, dailyBudget, weekStart) {
  if (emp.targetHours == null) return false
  const remaining = emp.targetHours - (totals[emp.name] || 0)
  if (remaining < 4) return false
  return remaining > futureCapacity(emp, dayIdx, operatingHours, dailyBudget, weekStart) + 0.05
}

function activeInWindow(shift, fromMins, toMins) {
  return timeToMins(shift.start) < toMins && timeToMins(shift.end, true) > fromMins
}

function createRng(seed) {
  let t = seed || 1
  return () => {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function isEligible(
  emp, dayKey, dayIdx, slotStartMins, slotEndMins,
  opDay, totals, assignedToday, lastClose,
  preventClopening, minHoursBetweenShifts, requiredRole,
  avoid, maxDays, daysWorked, maxCloses, closes, opEndMins,
  slotRequirements = {}
) {
  if (assignedToday.has(emp.name)) return false

  const av = emp.availability?.[dayKey]
  if (!av || av.available === false) return false
  if (opDay.date && isTimeOffDate(emp, opDay.date)) return false

  if (requiredRole && emp.role?.toLowerCase() !== requiredRole.toLowerCase()) return false

  const avStart = timeToMins(av.start || opDay.start)
  const avEnd = timeToMins(av.end || opDay.end, true)
  const actualStart = Math.max(slotStartMins, avStart, timeToMins(opDay.start))
  const actualEnd = Math.min(slotEndMins, avEnd, opEndMins)
  if (slotRequirements.latestStart != null && actualStart > slotRequirements.latestStart) return false
  if (slotRequirements.minEnd != null && actualEnd < slotRequirements.minEnd) return false

  const overlapStart = Math.max(slotStartMins, avStart)
  const overlapEnd = Math.min(slotEndMins, avEnd)
  if ((overlapEnd - overlapStart) < 4 * 60) return false

  if (preventClopening && lastClose[emp.name]) {
    const minGapMins = (minHoursBetweenShifts || 10) * 60
    const prev = lastClose[emp.name]
    const empStart = Math.max(slotStartMins, avStart)
    const gap = (dayIdx - prev.dayIdx) * 24 * 60 - prev.mins + empStart
    if (gap < minGapMins) return false
  }

  if (!slotRequirements.ignoreTarget && emp.targetHours != null) {
    const soFar = totals[emp.name] || 0
    if (soFar >= emp.targetHours - 0.05) return false
  }

  // avoidTogether: skip if a person they should avoid is already working today
  for (const pair of (avoid || [])) {
    if (pair.includes(emp.name)) {
      const other = pair.find(n => n !== emp.name)
      if (other && assignedToday.has(other)) return false
    }
  }

  // maxDays: skip if employee has already worked their weekly day limit
  if (maxDays?.[emp.name] != null && (daysWorked?.[emp.name] || 0) >= maxDays[emp.name]) return false

  // maxCloses: skip for closing slots when the employee has hit their close limit
  const isClosingSlot = opEndMins != null && slotEndMins >= opEndMins - 30
  if (isClosingSlot && maxCloses?.[emp.name] != null && (closes?.[emp.name] || 0) >= maxCloses[emp.name]) return false

  return true
}

function recordShift(emp, shift, totals, assignedToday, daysWorked, closes, lastClose, dayIdx, opEndMins, preventClopening) {
  totals[emp.name] = (totals[emp.name] || 0) + shift.hours
  assignedToday.add(emp.name)
  daysWorked[emp.name] = (daysWorked[emp.name] || 0) + 1
  const endsNearClose = timeToMins(shift.end) >= opEndMins - 30
  if (endsNearClose) {
    closes[emp.name] = (closes[emp.name] || 0) + 1
  }
  if (preventClopening && endsNearClose) lastClose[emp.name] = { dayIdx, mins: timeToMins(shift.end) }
}

export function runScheduler(employees, settings, weekStart, constraints = {}) {
  const { operatingHours, preventClopening, minHoursBetweenShifts } = settings
  const {
    slots: coverageSlots = [],
    pairs = [],
    prioritize = {},
    avoid = [],
    maxDays = {},
    maxCloses = {},
    preferWindows = {},
    shiftHoursByEmployee = {},
    trainingPairs = [],
    minimumStaff = [],
    seed = 1,
  } = constraints

  const totals = {}
  const lastClose = {}
  const daysWorked = {}
  const closes = {}
  const rng = createRng(seed)
  const jitter = {}
  DAYS.forEach(day => {
    jitter[day] = {}
    employees.forEach(emp => { jitter[day][emp.name] = rng() })
  })

  const dailyBudget = {}
  employees.forEach(emp => {
    if (emp.targetHours == null) return
    const fixedShiftHours = Number(shiftHoursByEmployee?.[emp.name]) || null
    const openAvailDays = DAYS.filter(d => {
      const av = emp.availability?.[d]
      return av && av.available !== false && operatingHours?.[d]?.open
    }).length
    const target = Number(emp.targetHours) || 0
    const idealWorkDays = Math.max(1, Math.ceil(target / (fixedShiftHours || 8)))
    const plannedWorkDays = Math.min(openAvailDays || idealWorkDays, idealWorkDays)
    dailyBudget[emp.name] = plannedWorkDays > 0
      ? (fixedShiftHours || Math.min(8.5, Math.ceil((target / plannedWorkDays) * 10) / 10))
      : (fixedShiftHours || Math.min(8.5, target))
  })

  const result = { weekStart, days: {}, summary: [], issues: [], recommendations: [] }

  DAYS.forEach((dayKey, dayIdx) => {
    const opDay = operatingHours?.[dayKey]
    const date = getDateForDay(weekStart, dayIdx)

    if (!opDay?.open) {
      result.days[dayKey] = { date, shifts: [], emptySlots: [] }
      return
    }

    const opStartMins = timeToMins(opDay.start)
    const opEndMins = timeToMins(opDay.end, true)
    const opDayWithDate = { ...opDay, date }

    const daySlots = coverageSlots.filter(s =>
      s.days === 'all' || (Array.isArray(s.days) && s.days.includes(dayKey))
    )

    const shifts = []
    const emptySlots = []
    const assignedToday = new Set()
    let shiftIdx = 1

    const priorityList = prioritize[dayKey] || []

    // Phase 1: fill defined coverage slots
    daySlots.forEach(slot => {
      const count = slot.count || 1
      const slotStart = timeToMins(slot.start)
      const slotEnd = timeToMins(slot.end)

      for (let i = 0; i < count; i++) {
        const eligible = employees
          .filter(emp => isEligible(
            emp, dayKey, dayIdx, slotStart, slotEnd, opDayWithDate, totals, assignedToday, lastClose,
            preventClopening, minHoursBetweenShifts, slot.role,
            avoid, maxDays, daysWorked, maxCloses, closes, opEndMins,
            { latestStart: slot.latestStart != null ? timeToMins(slot.latestStart) : null, minEnd: slot.minEnd != null ? timeToMins(slot.minEnd, true) : null }
          ))
          .sort((a, b) => {
            const aPrio = priorityList.includes(a.name) ? 1 : 0
            const bPrio = priorityList.includes(b.name) ? 1 : 0
            if (bPrio !== aPrio) return bPrio - aPrio
            const aRem = (a.targetHours ?? Infinity) - (totals[a.name] || 0)
            const bRem = (b.targetHours ?? Infinity) - (totals[b.name] || 0)
            if (bRem !== aRem) return bRem - aRem
            return (jitter[dayKey][b.name] || 0) - (jitter[dayKey][a.name] || 0)
          })

        if (eligible.length === 0) {
          emptySlots.push({ start: slot.start, end: slot.end, role: slot.role || '' })
          continue
        }

        const emp = eligible[0]
        const shift = computeShift(emp, dayKey, slotStart, slotEnd, opStartMins, opEndMins, totals, dayIdx, shiftIdx, dailyBudget, preferWindows, slot.anchor, {
          fixedHours: shiftHoursByEmployee?.[emp.name],
        })
        if (!shift) {
          emptySlots.push({ start: slot.start, end: slot.end, role: slot.role || '' })
          continue
        }

        shifts.push(shift)
        recordShift(emp, shift, totals, assignedToday, daysWorked, closes, lastClose, dayIdx, opEndMins, preventClopening)
        shiftIdx++
      }
    })

    // Phase 2: fill minimum-staff windows that are still short after role slots.
    minimumStaff.forEach(({ from, to, count }) => {
      const fromMins = timeToMins(from)
      const toMins = timeToMins(to, true)
      let active = shifts.filter(shift => activeInWindow(shift, fromMins, toMins)).length

      while (active < count) {
        const eligible = employees
          .filter(emp =>
            !assignedToday.has(emp.name) &&
            isEligible(
              emp, dayKey, dayIdx, fromMins, opEndMins, opDayWithDate, totals, assignedToday, lastClose,
              preventClopening, minHoursBetweenShifts, null,
              avoid, maxDays, daysWorked, maxCloses, closes, opEndMins
            )
          )
          .sort((a, b) => {
            const aPrio = priorityList.includes(a.name) ? 1 : 0
            const bPrio = priorityList.includes(b.name) ? 1 : 0
            if (bPrio !== aPrio) return bPrio - aPrio
            const aFuture = futureCapacity(a, dayIdx, operatingHours, dailyBudget, weekStart)
            const bFuture = futureCapacity(b, dayIdx, operatingHours, dailyBudget, weekStart)
            const aPressure = ((a.targetHours ?? 0) - (totals[a.name] || 0)) - aFuture
            const bPressure = ((b.targetHours ?? 0) - (totals[b.name] || 0)) - bFuture
            if (bPressure !== aPressure) return bPressure - aPressure
            const aRem = (a.targetHours ?? Infinity) - (totals[a.name] || 0)
            const bRem = (b.targetHours ?? Infinity) - (totals[b.name] || 0)
            if (bRem !== aRem) return bRem - aRem
            return (jitter[dayKey][b.name] || 0) - (jitter[dayKey][a.name] || 0)
          })

        if (eligible.length === 0) {
          emptySlots.push({ start: from, end: to, role: '' })
          break
        }

        const emp = eligible[0]
        const shift = computeShift(emp, dayKey, fromMins, opEndMins, opStartMins, opEndMins, totals, dayIdx, shiftIdx, dailyBudget, preferWindows, 'start', {
          fixedHours: shiftHoursByEmployee?.[emp.name],
        })
        if (!shift) {
          emptySlots.push({ start: from, end: to, role: '' })
          break
        }

        shifts.push(shift)
        recordShift(emp, shift, totals, assignedToday, daysWorked, closes, lastClose, dayIdx, opEndMins, preventClopening)
        shiftIdx++
        active = shifts.filter(s => activeInWindow(s, fromMins, toMins)).length
      }
    })

    // Phase 3: add flexible shifts only when someone needs today to hit target.
    const remaining = employees
      .filter(emp =>
        !assignedToday.has(emp.name) &&
        needsFlexShiftToday(emp, dayIdx, operatingHours, totals, dailyBudget, weekStart) &&
        isEligible(
          emp, dayKey, dayIdx, opStartMins, opEndMins, opDayWithDate, totals, assignedToday, lastClose,
          preventClopening, minHoursBetweenShifts, null,
          avoid, maxDays, daysWorked, maxCloses, closes, opEndMins
        )
      )
      .sort((a, b) => {
        const mgrA = a.role?.toLowerCase() === 'manager' ? 1 : 0
        const mgrB = b.role?.toLowerCase() === 'manager' ? 1 : 0
        if (mgrB !== mgrA) return mgrB - mgrA
        const aPrio = priorityList.includes(a.name) ? 1 : 0
        const bPrio = priorityList.includes(b.name) ? 1 : 0
        if (bPrio !== aPrio) return bPrio - aPrio
        const aRem = (a.targetHours ?? Infinity) - (totals[a.name] || 0)
        const bRem = (b.targetHours ?? Infinity) - (totals[b.name] || 0)
        if (bRem !== aRem) return bRem - aRem
        return (jitter[dayKey][b.name] || 0) - (jitter[dayKey][a.name] || 0)
      })

    remaining.forEach(emp => {
      const flex = chooseFlexWindow(emp, dayKey, opStartMins, opEndMins, totals, dailyBudget, shiftHoursByEmployee?.[emp.name])
      if (!flex) return
      const shift = computeShift(emp, dayKey, flex.start, flex.end, opStartMins, opEndMins, totals, dayIdx, shiftIdx, dailyBudget, preferWindows, 'start', {
        fixedHours: shiftHoursByEmployee?.[emp.name],
      })
      if (!shift) return
      shifts.push(shift)
      recordShift(emp, shift, totals, assignedToday, daysWorked, closes, lastClose, dayIdx, opEndMins, preventClopening)
      shiftIdx++
    })

    // Phase 4a: pairTogether — add missing partners and align existing non-overlapping pairs.
    pairs.forEach(([a, b]) => {
      const scheduledA = assignedToday.has(a)
      const scheduledB = assignedToday.has(b)

      if (scheduledA && scheduledB) {
        const shiftA = shifts.find(s => s.employee === a)
        const shiftB = shifts.find(s => s.employee === b)
        if (!shiftA || !shiftB || activeInWindow(shiftA, timeToMins(shiftB.start), timeToMins(shiftB.end, true))) return

        const empB = employees.find(e => e.name === b)
        if (!empB) return
        const replacement = computeShift(
          empB, dayKey, timeToMins(shiftA.start), timeToMins(shiftA.end, true),
          opStartMins, opEndMins, totals, dayIdx, shiftIdx, dailyBudget, preferWindows, 'start',
          { allowOverTarget: true, fixedHours: shiftHoursByEmployee?.[b] }
        )
        if (!replacement) return
        const oldEndedNearClose = timeToMins(shiftB.end) >= opEndMins - 30
        const newEndsNearClose = timeToMins(replacement.end) >= opEndMins - 30
        totals[b] = Math.max(0, (totals[b] || 0) - (Number(shiftB.hours) || 0) + replacement.hours)
        if (oldEndedNearClose && !newEndsNearClose) closes[b] = Math.max(0, (closes[b] || 0) - 1)
        if (!oldEndedNearClose && newEndsNearClose) closes[b] = (closes[b] || 0) + 1
        if (preventClopening) {
          if (newEndsNearClose) lastClose[b] = { dayIdx, mins: timeToMins(replacement.end) }
          else if (lastClose[b]?.dayIdx === dayIdx) delete lastClose[b]
        }
        Object.assign(shiftB, { ...replacement, id: shiftB.id })
        return
      }

      if (scheduledA === scheduledB) return

      const missingName = scheduledA ? b : a
      const presentName = scheduledA ? a : b
      const missing = employees.find(e => e.name === missingName)
      const presentShift = shifts.find(s => s.employee === presentName)
      if (!missing) return
      if (!isEligible(
        missing, dayKey, dayIdx, opStartMins, opEndMins, opDayWithDate, totals, assignedToday, lastClose,
        preventClopening, minHoursBetweenShifts, null,
        avoid, maxDays, daysWorked, maxCloses, closes, opEndMins,
        { ignoreTarget: true }
      )) return

      const pairStart = presentShift ? timeToMins(presentShift.start) : opStartMins
      const pairEnd = presentShift ? timeToMins(presentShift.end, true) : opEndMins
      const shift = computeShift(
        missing, dayKey, pairStart, pairEnd, opStartMins, opEndMins,
        totals, dayIdx, shiftIdx, dailyBudget, preferWindows, 'start',
        { allowOverTarget: true, fixedHours: shiftHoursByEmployee?.[missing.name] }
      )
      if (!shift) return
      shifts.push(shift)
      recordShift(missing, shift, totals, assignedToday, daysWorked, closes, lastClose, dayIdx, opEndMins, preventClopening)
      shiftIdx++
    })

    // Phase 4b: trainingPairs — if a trainee is scheduled, ensure a mentor of the right role is also on
    trainingPairs.forEach(({ trainee, mentorRole }) => {
      if (!assignedToday.has(trainee)) return
      const alreadyHasMentor = [...assignedToday].some(name => {
        const e = employees.find(x => x.name === name)
        return e?.role?.toLowerCase() === mentorRole?.toLowerCase()
      })
      if (alreadyHasMentor) return

      const mentor = employees.find(e =>
        e.role?.toLowerCase() === mentorRole?.toLowerCase() &&
        isEligible(
          e, dayKey, dayIdx, opStartMins, opEndMins, opDayWithDate, totals, assignedToday, lastClose,
          preventClopening, minHoursBetweenShifts, null,
          avoid, maxDays, daysWorked, maxCloses, closes, opEndMins
        )
      )
      if (!mentor) return

      const flex = chooseFlexWindow(mentor, dayKey, opStartMins, opEndMins, totals, dailyBudget, shiftHoursByEmployee?.[mentor.name])
      if (!flex) return
      const shift = computeShift(mentor, dayKey, flex.start, flex.end, opStartMins, opEndMins, totals, dayIdx, shiftIdx, dailyBudget, preferWindows, 'start', {
        fixedHours: shiftHoursByEmployee?.[mentor.name],
      })
      if (!shift) return
      shifts.push(shift)
      recordShift(mentor, shift, totals, assignedToday, daysWorked, closes, lastClose, dayIdx, opEndMins, preventClopening)
      shiftIdx++
    })

    result.days[dayKey] = { date, shifts, emptySlots }
  })

  result.summary = employees.map(emp => {
    const scheduled = Math.round((totals[emp.name] || 0) * 10) / 10
    const target = Number(emp.targetHours) || 0
    return {
      employee: emp.name,
      role: emp.role || '',
      scheduledHours: scheduled,
      targetHours: target,
      difference: Math.round((scheduled - target) * 10) / 10,
    }
  })

  return result
}
