const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_ABBR = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']

function timeToMins(hhmm, asClose = false) {
  if (!hhmm || typeof hhmm !== 'string') return asClose ? 24 * 60 : 0
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h)) return asClose ? 24 * 60 : 0
  const mins = h * 60 + (m || 0)
  return asClose && mins === 0 ? 24 * 60 : mins
}

// Minutes are counted from the start of the day a shift belongs to, so an
// overnight shift ending at 2am is 26:00. Display code turns that back into a
// wall clock with a next-day marker; every arithmetic consumer can keep
// treating the string as plain minutes.
function minsToTime(mins) {
  mins = Math.max(0, Math.min(mins, 48 * 60))
  if (mins === 24 * 60) return '24:00'
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

// A day that closes at or before it opens trades past midnight: 20:00 to 02:00
// is a six hour night, not an empty day.
function operatingWindow(opDay) {
  if (!opDay?.open) return null
  const start = timeToMins(opDay.start)
  let end = timeToMins(opDay.end, true)
  if (end <= start) end += 24 * 60
  return { start, end, overnight: end > 24 * 60 }
}

// Resolves any wall-clock window (availability, a coverage slot, a minimum
// staffing window) onto the same timeline as the operating window it sits in.
function resolveWindow(startValue, endValue, opStartMins, opEndMins) {
  let start = startValue ? timeToMins(startValue) : opStartMins
  let end = endValue ? timeToMins(endValue, true) : opEndMins
  // The window itself crosses midnight, e.g. available 20:00 to 02:00.
  if (end <= start) end += 24 * 60
  // The window sits wholly in the small hours of an overnight day, e.g.
  // available 00:00 to 04:00 while the bar runs 20:00 to 02:00.
  if (opEndMins > 24 * 60 && end <= opStartMins) {
    start += 24 * 60
    end += 24 * 60
  }
  return { start, end }
}

function availabilityWindow(av, opStartMins, opEndMins) {
  if (!av) return null
  return resolveWindow(av.start, av.end, opStartMins, opEndMins)
}

function snapHalf(mins) {
  return Math.round(mins / 30) * 30
}

// Shifts land on half hours, but rounding a boundary the wrong way would put
// someone on the floor before they are available or after they have left, so
// each bound is snapped inward.
function ceilHalf(mins) {
  return Math.ceil(mins / 30) * 30
}

function floorHalf(mins) {
  return Math.floor(mins / 30) * 30
}

function getDateForDay(weekStart, idx) {
  const d = new Date(weekStart + 'T12:00:00')
  // A malformed weekStart should not take the whole generation down; callers
  // treat an empty date as "no calendar date for this day".
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + idx)
  return d.toISOString().split('T')[0]
}

function isTimeOffDate(emp, date) {
  if (!date || !emp.timeOff?.length) return false
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
//   minimumStaff: [{from, to, count, days?}],  // days omitted = every open day
// }

function computeShift(emp, dayKey, slotStartMins, slotEndMins, opStartMins, opEndMins, totals, dayIdx, idx, dailyBudget, preferWindows, anchor = 'start', options = {}) {
  const av = emp.availability[dayKey]
  const { start: avStart, end: avEnd } = availabilityWindow(av, opStartMins, opEndMins)

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
    end = floorHalf(Math.min(effEnd, avEnd, opEndMins))
    start = ceilHalf(Math.max(effStart, avStart, opStartMins, end - todayMaxHours * 60))
    if (end - start > 8.5 * 60) start = end - 8.5 * 60
  } else {
    start = ceilHalf(Math.max(effStart, avStart, opStartMins))
    end = floorHalf(Math.min(effEnd, avEnd, opEndMins, start + todayMaxHours * 60))
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

  const { start: avStart, end: avEnd } = availabilityWindow(av, opStartMins, opEndMins)
  const remaining = emp.targetHours != null
    ? emp.targetHours - (totals[emp.name] || 0)
    : 8.5
  const budget = emp.targetHours != null ? (dailyBudget?.[emp.name] ?? remaining) : 8.5
  const hours = fixedHours || Math.min(8.5, remaining, budget)
  if (hours < 4) return null

  const earliest = Math.max(avStart, opStartMins)
  const latestEnd = Math.min(avEnd, opEndMins)
  const room = latestEnd - earliest

  // A short trading day cannot fit a full daily budget. Take what the window
  // allows instead of scheduling nobody — a six hour night is a shift, not a
  // reason to leave the bar empty. An exact shift length that does not fit is
  // still refused, since shortening it would break the rule that set it.
  const duration = fixedHours ? hours * 60 : Math.min(hours * 60, room)
  if (duration < 4 * 60 || duration > room) return null

  const latest = latestEnd - duration

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

  const op = operatingWindow(opDay)
  if (!op) return 0
  const { start: avStart, end: avEnd } = availabilityWindow(av, op.start, op.end)
  const availableHours = Math.max(0, Math.min(avEnd, op.end) - Math.max(avStart, op.start)) / 60
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

function needsFlexShiftToday(emp, dayIdx, operatingHours, totals, dailyBudget, weekStart, plannedDays) {
  if (emp.targetHours == null) return false
  const remaining = emp.targetHours - (totals[emp.name] || 0)
  if (remaining < 4) return false
  // Today is the last chance to fit the hours in.
  if (remaining > futureCapacity(emp, dayIdx, operatingHours, dailyBudget, weekStart) + 0.05) return true
  // Otherwise work the days planned for this person. Without this the schedule
  // only fills a day once it becomes unavoidable, which leaves the start of the
  // week empty and stacks every shift onto the last few days.
  return plannedDays?.has(dayIdx) === true
}

// Spread an employee's expected working days evenly over the days they are
// actually available, so a five-day target lands Mon/Tue/Wed/Fri/Sat rather
// than Wed through Sun.
function planFlexDays(emp, operatingHours, weekStart, dailyBudget) {
  const openIdxs = DAYS.reduce((acc, dayKey, idx) => {
    const av = emp.availability?.[dayKey]
    if (!av || av.available === false) return acc
    if (!operatingHours?.[dayKey]?.open) return acc
    if (isTimeOffDate(emp, getDateForDay(weekStart, idx))) return acc
    acc.push(idx)
    return acc
  }, [])

  const target = Number(emp.targetHours) || 0
  const budget = dailyBudget[emp.name] || 8
  const needed = Math.min(openIdxs.length, Math.max(0, Math.ceil(target / budget)))

  const chosen = new Set()
  for (let k = 0; k < needed; k++) {
    chosen.add(openIdxs[Math.floor((k * openIdxs.length) / needed)])
  }
  return chosen
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

  const opStartMins = timeToMins(opDay.start)
  const { start: avStart, end: avEnd } = availabilityWindow(av, opStartMins, opEndMins)
  const actualStart = Math.max(slotStartMins, avStart, opStartMins)
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

// ---------------------------------------------------------------------------
// Constraints arrive from a language model parsing someone's plain-English
// rules, so the shapes below are "close to the schema" rather than the schema.
// Everything is coerced to what the engine expects and anything unusable is
// dropped, so a bad parse degrades into fewer rules instead of a crash or a
// schedule full of NaN.
// ---------------------------------------------------------------------------

const MAX_SLOT_COUNT = 50

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanTime(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function cleanName(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanCount(value, fallback, max) {
  const count = Math.floor(Number(value))
  if (!Number.isFinite(count) || count < 1) return fallback
  return Math.min(count, max)
}

function cleanDays(value) {
  if (value === 'all' || value == null) return 'all'
  const list = (Array.isArray(value) ? value : [value])
    .map(day => (typeof day === 'string' ? day.trim().toLowerCase() : null))
    .filter(day => DAYS.includes(day))
  return list.length ? list : 'all'
}

function cleanNumberMap(value, { min = 0, max = Infinity } = {}) {
  if (!isPlainObject(value)) return {}
  const result = {}
  for (const [name, raw] of Object.entries(value)) {
    const number = Number(raw)
    if (!cleanName(name) || !Number.isFinite(number)) continue
    if (number < min || number > max) continue
    result[name] = number
  }
  return result
}

function cleanPairs(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(pair => (Array.isArray(pair) ? [cleanName(pair[0]), cleanName(pair[1])] : null))
    .filter(pair => pair && pair[0] && pair[1] && pair[0] !== pair[1])
}

function normalizeConstraints(raw) {
  const input = isPlainObject(raw) ? raw : {}

  const slots = (Array.isArray(input.slots) ? input.slots : [])
    .map(slot => {
      if (!isPlainObject(slot)) return null
      const start = cleanTime(slot.start)
      const end = cleanTime(slot.end)
      if (!start || !end) return null
      return {
        start,
        end,
        role: cleanName(slot.role),
        count: cleanCount(slot.count, 1, MAX_SLOT_COUNT),
        days: cleanDays(slot.days),
        anchor: slot.anchor === 'end' ? 'end' : 'start',
        latestStart: cleanTime(slot.latestStart),
        minEnd: cleanTime(slot.minEnd),
      }
    })
    .filter(Boolean)

  const minimumStaff = (Array.isArray(input.minimumStaff) ? input.minimumStaff : [])
    .map(entry => {
      if (!isPlainObject(entry)) return null
      const from = cleanTime(entry.from)
      const to = cleanTime(entry.to)
      if (!from || !to) return null
      return { from, to, count: cleanCount(entry.count, 1, MAX_SLOT_COUNT), days: cleanDays(entry.days) }
    })
    .filter(Boolean)

  const prioritize = {}
  if (isPlainObject(input.prioritize)) {
    for (const [day, names] of Object.entries(input.prioritize)) {
      const dayKey = typeof day === 'string' ? day.trim().toLowerCase() : ''
      if (!DAYS.includes(dayKey) || !Array.isArray(names)) continue
      prioritize[dayKey] = names.map(cleanName).filter(Boolean)
    }
  }

  const preferWindows = {}
  if (isPlainObject(input.preferWindows)) {
    for (const [name, window] of Object.entries(input.preferWindows)) {
      if (!cleanName(name) || !isPlainObject(window)) continue
      const start = cleanTime(window.start)
      const end = cleanTime(window.end)
      if (start && end) preferWindows[name] = { start, end }
    }
  }

  const trainingPairs = (Array.isArray(input.trainingPairs) ? input.trainingPairs : [])
    .map(pair => {
      if (!isPlainObject(pair)) return null
      const trainee = cleanName(pair.trainee)
      const mentorRole = cleanName(pair.mentorRole)
      return trainee && mentorRole ? { trainee, mentorRole } : null
    })
    .filter(Boolean)

  const seed = Number(input.seed)

  return {
    slots,
    pairs: cleanPairs(input.pairs),
    avoid: cleanPairs(input.avoid),
    prioritize,
    maxDays: cleanNumberMap(input.maxDays, { min: 0 }),
    maxCloses: cleanNumberMap(input.maxCloses, { min: 0 }),
    preferWindows,
    // A shift is between 4 and 8.5 hours; anything outside that cannot be honoured.
    shiftHoursByEmployee: cleanNumberMap(input.shiftHoursByEmployee, { min: 4, max: 8.5 }),
    trainingPairs,
    minimumStaff,
    seed: Number.isFinite(seed) ? seed : 1,
  }
}

export function runScheduler(employees, settings, weekStart, rawConstraints = {}) {
  const constraints = normalizeConstraints(rawConstraints)
  const { operatingHours, preventClopening, minHoursBetweenShifts } = settings || {}
  const {
    slots: coverageSlots,
    pairs,
    prioritize,
    avoid,
    maxDays,
    maxCloses,
    preferWindows,
    shiftHoursByEmployee,
    trainingPairs,
    minimumStaff,
    seed,
  } = constraints
  const roster = Array.isArray(employees) ? employees.filter(isPlainObject) : []

  const totals = {}
  const lastClose = {}
  const daysWorked = {}
  const closes = {}
  const rng = createRng(seed)
  const jitter = {}
  DAYS.forEach(day => {
    jitter[day] = {}
    roster.forEach(emp => { jitter[day][emp.name] = rng() })
  })

  const dailyBudget = {}
  roster.forEach(emp => {
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

  const plannedFlexDays = {}
  roster.forEach(emp => {
    if (emp.targetHours == null) return
    plannedFlexDays[emp.name] = planFlexDays(emp, operatingHours, weekStart, dailyBudget)
  })

  const result = { weekStart, days: {}, summary: [], issues: [], recommendations: [] }

  DAYS.forEach((dayKey, dayIdx) => {
    const opDay = operatingHours?.[dayKey]
    const date = getDateForDay(weekStart, dayIdx)

    if (!opDay?.open) {
      result.days[dayKey] = { date, shifts: [], emptySlots: [] }
      return
    }

    const { start: opStartMins, end: opEndMins } = operatingWindow(opDay)
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
      // "18:00 to 00:00" means until midnight, not a zero-length window, and on
      // an overnight day "20:00 to 02:00" runs into the small hours.
      const { start: slotStart, end: slotEnd } = resolveWindow(slot.start, slot.end, opStartMins, opEndMins)

      for (let i = 0; i < count; i++) {
        const eligible = roster
          .filter(emp => isEligible(
            emp, dayKey, dayIdx, slotStart, slotEnd, opDayWithDate, totals, assignedToday, lastClose,
            preventClopening, minHoursBetweenShifts, slot.role,
            avoid, maxDays, daysWorked, maxCloses, closes, opEndMins,
            {
              latestStart: slot.latestStart != null
                ? resolveWindow(slot.latestStart, slot.latestStart, opStartMins, opEndMins).start
                : null,
              minEnd: slot.minEnd != null
                ? resolveWindow(slot.minEnd, slot.minEnd, opStartMins, opEndMins).start
                : null,
            }
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
    // Entries without `days` come from parsed rules and apply to every open day;
    // per-day workspace minimums name the day they belong to.
    const dayMinimums = minimumStaff.filter(m =>
      !m.days || m.days === 'all' || (Array.isArray(m.days) && m.days.includes(dayKey))
    )

    dayMinimums.forEach(({ from, to, count }) => {
      const { start: fromMins, end: toMins } = resolveWindow(from, to, opStartMins, opEndMins)
      let active = shifts.filter(shift => activeInWindow(shift, fromMins, toMins)).length

      while (active < count) {
        const eligible = roster
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
    const remaining = roster
      .filter(emp =>
        !assignedToday.has(emp.name) &&
        needsFlexShiftToday(emp, dayIdx, operatingHours, totals, dailyBudget, weekStart, plannedFlexDays[emp.name]) &&
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
      // Eligibility above was computed before anyone in this phase was assigned.
      // Re-check it here: avoidTogether depends on who is already working today,
      // so a snapshot would let both halves of a keep-apart pair through.
      if (!isEligible(
        emp, dayKey, dayIdx, opStartMins, opEndMins, opDayWithDate, totals, assignedToday, lastClose,
        preventClopening, minHoursBetweenShifts, null,
        avoid, maxDays, daysWorked, maxCloses, closes, opEndMins
      )) return

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

        const empB = roster.find(e => e.name === b)
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
      const missing = roster.find(e => e.name === missingName)
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
        const e = roster.find(x => x.name === name)
        return e?.role?.toLowerCase() === mentorRole?.toLowerCase()
      })
      if (alreadyHasMentor) return

      const mentor = roster.find(e =>
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

  result.summary = roster.map(emp => {
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
