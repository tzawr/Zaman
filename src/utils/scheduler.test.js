import assert from 'node:assert/strict'
import test from 'node:test'
import { runScheduler } from './scheduler.js'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const everyDay = (value) => Object.fromEntries(DAYS.map(day => [day, { ...value }]))
const open = (start, end) => everyDay({ open: true, start, end })
const person = (name, role, targetHours, availability = { available: true, start: '', end: '' }) => ({
  name,
  role,
  targetHours,
  availability: everyDay(availability),
  timeOff: [],
})
const allShifts = (result) => DAYS.flatMap(day => result.days[day].shifts)
const toMins = (hhmm, close = false) => {
  const [h, m] = hhmm.split(':').map(Number)
  const value = h * 60 + (m || 0)
  return close && value === 0 ? 1440 : value
}

test('a coverage slot ending at midnight covers the evening', () => {
  const result = runScheduler(
    [person('Ava', 'Barista', 40), person('Bo', 'Barista', 40)],
    { operatingHours: open('06:00', '00:00') },
    '2026-05-04',
    { slots: [{ start: '18:00', end: '00:00', role: 'Barista', count: 1, days: 'all' }] },
  )

  const evening = result.days.monday.shifts.find(shift => shift.start === '18:00')
  assert.ok(evening, 'the 18:00-00:00 slot should be filled, not reported as a gap')
  assert.equal(evening.end, '24:00')
  assert.equal(result.days.monday.emptySlots.length, 0)
})

test('shifts stay inside quarter-hour availability windows', () => {
  const result = runScheduler(
    [person('Ava', 'Barista', 40, { available: true, start: '10:15', end: '18:45' })],
    { operatingHours: open('06:00', '22:00') },
    '2026-05-04',
    {},
  )

  for (const shift of allShifts(result)) {
    assert.ok(toMins(shift.start) >= toMins('10:15'), `${shift.start} starts before availability`)
    assert.ok(toMins(shift.end, true) <= toMins('18:45'), `${shift.end} runs past availability`)
  }
})

test('flexible shifts spread across the week instead of stacking at the end', () => {
  const result = runScheduler(
    [person('Ava', 'Barista', 40)],
    { operatingHours: open('08:00', '20:00') },
    '2026-05-04',
    {},
  )

  const workedEarly = ['monday', 'tuesday', 'wednesday'].filter(day => result.days[day].shifts.length > 0)
  assert.ok(workedEarly.length >= 2, `expected work early in the week, got ${JSON.stringify(workedEarly)}`)
  assert.equal(result.summary[0].scheduledHours, 40)
})

test('keep-apart pairs are never scheduled on the same day', () => {
  // Ava and Bo both need hours and nothing else competes for the day, so an
  // eligibility check taken before the day was filled used to let both through.
  const result = runScheduler(
    [person('Ava', 'Barista', 40), person('Bo', 'Barista', 40), person('Cy', 'Barista', 40)],
    { operatingHours: open('08:00', '20:00') },
    '2026-05-04',
    { avoid: [['Ava', 'Bo']] },
  )

  for (const day of DAYS) {
    const names = result.days[day].shifts.map(shift => shift.employee)
    assert.ok(
      !(names.includes('Ava') && names.includes('Bo')),
      `Ava and Bo both scheduled on ${day}`,
    )
  }
})

test('a malformed week start does not throw', () => {
  const result = runScheduler(
    [person('Ava', 'Barista', 20)],
    { operatingHours: open('08:00', '20:00') },
    'not-a-date',
    {},
  )
  assert.equal(result.days.monday.date, '')
})

test('same seed produces the same schedule, a different seed does not', () => {
  const employees = [person('Ava', 'Barista', 30), person('Bo', 'Supervisor', 30), person('Cy', 'Barista', 20)]
  const settings = { operatingHours: open('06:00', '22:00'), preventClopening: true, minHoursBetweenShifts: 10 }
  const constraints = { slots: [{ start: '06:00', end: '14:00', count: 2, days: 'all' }] }

  const a = JSON.stringify(runScheduler(employees, settings, '2026-05-04', { ...constraints, seed: 42 }))
  const b = JSON.stringify(runScheduler(employees, settings, '2026-05-04', { ...constraints, seed: 42 }))
  const c = JSON.stringify(runScheduler(employees, settings, '2026-05-04', { ...constraints, seed: 43 }))

  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('degenerate inputs produce an empty schedule rather than an error', () => {
  const settings = { operatingHours: open('08:00', '18:00') }

  assert.equal(runScheduler([], settings, '2026-05-04', {}).summary.length, 0)
  assert.equal(allShifts(runScheduler([person('Ava', 'Barista', 20)], {}, '2026-05-04', {})).length, 0)
  assert.equal(
    allShifts(runScheduler([{ name: 'Ava', role: 'Barista', targetHours: 20 }], settings, '2026-05-04', {})).length,
    0,
  )
})

test('approved time off is never scheduled over', () => {
  const employee = person('Ava', 'Barista', 40)
  employee.timeOff = [{ start: '2026-05-06', end: '2026-05-08' }]

  const result = runScheduler([employee], { operatingHours: open('08:00', '20:00') }, '2026-05-04', {})

  for (const day of ['wednesday', 'thursday', 'friday']) {
    assert.equal(result.days[day].shifts.length, 0, `scheduled during time off on ${day}`)
  }
})

// Property test: every generated schedule must satisfy the promises the product
// makes to a manager, across a wide spread of randomly generated workspaces.
test('generated schedules hold their invariants across 500 random workspaces', () => {
  const rng = (seed) => {
    let t = seed
    return () => {
      t += 0x6D2B79F5
      let r = Math.imul(t ^ (t >>> 15), 1 | t)
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
  }
  const NAMES = ['Ava', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal']
  const ROLES = ['Barista', 'Supervisor', 'Manager', 'Cashier']

  for (let seed = 1; seed <= 500; seed++) {
    const r = rng(seed)
    const pick = (arr) => arr[Math.floor(r() * arr.length)]

    const employees = Array.from({ length: 1 + Math.floor(r() * 7) }, (_, i) => {
      const availability = {}
      DAYS.forEach(day => {
        const roll = r()
        if (roll < 0.15) availability[day] = { available: false }
        else if (roll < 0.5) availability[day] = { available: true, start: '', end: '' }
        else availability[day] = {
          available: true,
          start: `${String([0, 6, 8, 9, 10, 11][Math.floor(r() * 6)]).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`,
          end: `${String([14, 16, 18, 20, 22, 23][Math.floor(r() * 6)]).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`,
        }
      })
      return {
        name: NAMES[i],
        role: pick(ROLES),
        targetHours: r() < 0.2 ? null : Math.floor(r() * 45),
        availability,
        timeOff: r() < 0.25 ? [{ start: '2026-05-05', end: '2026-05-07' }] : [],
      }
    })

    const operatingHours = {}
    DAYS.forEach(day => {
      // A quarter of days trade overnight: they close earlier than they open.
      const overnight = r() < 0.25
      operatingHours[day] = {
        open: r() > 0.15,
        start: overnight
          ? `${String([17, 18, 19, 20, 21, 22][Math.floor(r() * 6)]).padStart(2, '0')}:00`
          : `${String([0, 5, 6, 7, 8, 9][Math.floor(r() * 6)]).padStart(2, '0')}:00`,
        end: overnight
          ? `${String([0, 1, 2, 3, 4, 5][Math.floor(r() * 6)]).padStart(2, '0')}:00`
          : `${String([15, 17, 18, 20, 22, 23, 0][Math.floor(r() * 7)]).padStart(2, '0')}:00`,
      }
    })

    const settings = {
      operatingHours,
      preventClopening: r() > 0.4,
      minHoursBetweenShifts: [8, 10, 12][Math.floor(r() * 3)],
    }

    const constraints = { seed: Math.floor(r() * 10000) }
    if (r() < 0.7) {
      constraints.slots = [{
        start: `${String([5, 6, 7, 8, 9][Math.floor(r() * 5)]).padStart(2, '0')}:00`,
        end: `${String([13, 14, 16, 17, 20, 22, 0][Math.floor(r() * 7)]).padStart(2, '0')}:00`,
        role: r() < 0.5 ? pick(ROLES) : null,
        count: 1 + Math.floor(r() * 2),
        days: 'all',
        anchor: r() < 0.25 ? 'end' : 'start',
      }]
    }
    if (r() < 0.3 && employees.length > 1) constraints.avoid = [[employees[0].name, employees[1].name]]
    if (r() < 0.3) constraints.maxDays = { [employees[0].name]: 1 + Math.floor(r() * 4) }
    if (r() < 0.3) constraints.maxCloses = { [employees[0].name]: Math.floor(r() * 3) }
    if (r() < 0.3) constraints.minimumStaff = [{ from: '11:00', to: '14:00', count: 1 + Math.floor(r() * 2) }]

    const result = runScheduler(employees, settings, '2026-05-04', constraints)
    const byName = Object.fromEntries(employees.map(e => [e.name, e]))
    const totals = {}
    const daysWorked = {}
    const closes = {}
    const lastClose = {}

    DAYS.forEach((dayKey, dayIdx) => {
      const day = result.days[dayKey]
      const opDay = operatingHours[dayKey]
      const context = `seed ${seed} ${dayKey}`

      if (!opDay.open) {
        assert.equal(day.shifts.length, 0, `${context}: scheduled on a closed day`)
        return
      }

      const opStart = toMins(opDay.start)
      let opEnd = toMins(opDay.end, true)
      // A day closing at or before it opens runs past midnight.
      if (opEnd <= opStart) opEnd += 24 * 60
      const resolve = (startValue, endValue) => {
        let from = startValue ? toMins(startValue) : opStart
        let to = endValue ? toMins(endValue, true) : opEnd
        if (to <= from) to += 24 * 60
        if (opEnd > 24 * 60 && to <= opStart) { from += 24 * 60; to += 24 * 60 }
        return [from, to]
      }
      const today = new Set()

      for (const shift of day.shifts) {
        const employee = byName[shift.employee]
        assert.ok(employee, `${context}: unknown employee ${shift.employee}`)
        assert.ok(!today.has(shift.employee), `${context}: ${shift.employee} scheduled twice`)
        today.add(shift.employee)

        const start = toMins(shift.start)
        const end = toMins(shift.end, true)
        assert.ok(start >= opStart && end <= opEnd, `${context}: ${shift.employee} outside operating hours`)

        const av = employee.availability[dayKey]
        assert.ok(av && av.available !== false, `${context}: ${shift.employee} scheduled while unavailable`)
        const [avStart, avEnd] = resolve(av.start, av.end)
        assert.ok(
          start >= avStart && end <= avEnd,
          `${context}: ${shift.employee} outside their availability`,
        )

        const hours = (end - start) / 60
        assert.ok(hours >= 4 && hours <= 8.5, `${context}: ${shift.employee} shift is ${hours}h`)
        assert.ok(Math.abs(hours - shift.hours) < 0.06, `${context}: reported hours disagree with times`)

        if (employee.timeOff.length) {
          const stamp = new Date(`${day.date}T12:00:00`).getTime()
          const off = employee.timeOff.some(range =>
            stamp >= new Date(`${range.start}T00:00:00`).getTime() &&
            stamp <= new Date(`${range.end}T00:00:00`).getTime() + 86399000)
          assert.ok(!off, `${context}: ${shift.employee} scheduled during time off`)
        }

        totals[shift.employee] = (totals[shift.employee] || 0) + shift.hours
        daysWorked[shift.employee] = (daysWorked[shift.employee] || 0) + 1

        if (settings.preventClopening) {
          const prev = lastClose[shift.employee]
          if (prev && prev.dayIdx < dayIdx) {
            const gap = (dayIdx - prev.dayIdx) * 1440 - prev.mins + start
            assert.ok(gap >= settings.minHoursBetweenShifts * 60, `${context}: clopening gap of ${gap / 60}h`)
          }
        }
        if (end >= opEnd - 30) {
          closes[shift.employee] = (closes[shift.employee] || 0) + 1
          lastClose[shift.employee] = { dayIdx, mins: end }
        }
      }

      for (const [a, b] of constraints.avoid || []) {
        assert.ok(!(today.has(a) && today.has(b)), `${context}: keep-apart pair ${a}/${b} scheduled together`)
      }
    })

    for (const [name, limit] of Object.entries(constraints.maxDays || {})) {
      assert.ok((daysWorked[name] || 0) <= limit, `seed ${seed}: ${name} worked past their day limit`)
    }
    for (const [name, limit] of Object.entries(constraints.maxCloses || {})) {
      assert.ok((closes[name] || 0) <= limit, `seed ${seed}: ${name} closed past their limit`)
    }
    for (const row of result.summary) {
      const actual = Math.round((totals[row.employee] || 0) * 10) / 10
      assert.ok(Math.abs(actual - row.scheduledHours) < 0.11, `seed ${seed}: summary hours wrong for ${row.employee}`)
    }
  }
})

// Constraints come from a language model parsing plain-English rules, so the
// engine has to survive output that is close to the schema but not quite it.
test('malformed AI-parsed constraints degrade instead of crashing', () => {
  const employees = [
    { name: 'Ava', role: 'Barista', targetHours: 30, availability: everyDay({ available: true, start: '', end: '' }), timeOff: [] },
    { name: 'Bo', role: 'Supervisor', targetHours: 20, availability: everyDay({ available: true, start: '', end: '' }), timeOff: [] },
  ]
  const settings = { operatingHours: open('08:00', '20:00'), preventClopening: true, minHoursBetweenShifts: 10 }

  const hostile = [
    ['slots as an object', { slots: { start: '08:00', end: '16:00' } }],
    ['slots as a string', { slots: 'every morning' }],
    ['slot times as numbers', { slots: [{ start: 8, end: 16, count: 1, days: 'all' }] }],
    ['slot times in 12-hour text', { slots: [{ start: '8am', end: '4pm', count: 1, days: 'all' }] }],
    ['an absurd slot count', { slots: [{ start: '08:00', end: '16:00', count: 1e6, days: 'all' }] }],
    ['explicit nulls for every rule', {
      slots: null, pairs: null, avoid: null, maxDays: null, maxCloses: null,
      preferWindows: null, shiftHoursByEmployee: null, trainingPairs: null,
      minimumStaff: null, prioritize: null,
    }],
    ['a pair containing null', { pairs: [null, ['Ava', null]] }],
    ['avoid as an object', { avoid: { Ava: 'Bo' } }],
    ['trainingPairs as a string', { trainingPairs: 'Ava with a manager' }],
    ['minimumStaff as an object', { minimumStaff: { from: '11:00', to: '14:00', count: 2 } }],
    ['minimumStaff with unparseable times', { minimumStaff: [{ from: 'later', to: 'soon', count: 2 }] }],
    ['shift hours as a word', { shiftHoursByEmployee: { Ava: 'four' } }],
    ['constraints as an array', []],
    ['constraints as a string', 'no rules'],
  ]

  for (const [label, constraints] of hostile) {
    const started = Date.now()
    let result
    assert.doesNotThrow(() => { result = runScheduler(employees, settings, '2026-05-04', constraints) }, `threw on ${label}`)
    assert.ok(Date.now() - started < 1000, `${label} took too long`)

    for (const shift of allShifts(result)) {
      assert.ok(shift.start && shift.end, `${label} produced a shift without times`)
      assert.ok(Number.isFinite(shift.hours) && shift.hours > 0, `${label} produced ${shift.hours} hours`)
    }
  }
})

test('an employee list that is missing or malformed is ignored', () => {
  const settings = { operatingHours: open('08:00', '20:00') }
  assert.doesNotThrow(() => runScheduler(null, settings, '2026-05-04', {}))
  assert.doesNotThrow(() => runScheduler([null, 'Ava', 42], settings, '2026-05-04', {}))
  assert.equal(runScheduler([null, 'Ava'], settings, '2026-05-04', {}).summary.length, 0)
})

test('a bar trading past midnight gets staffed', () => {
  const result = runScheduler(
    [person('Ava', 'Bartender', 30), person('Bo', 'Bartender', 30)],
    { operatingHours: open('20:00', '02:00') },
    '2026-05-04',
    {},
  )

  const monday = result.days.monday.shifts
  assert.ok(monday.length > 0, 'an overnight day should be staffed, not left empty')
  for (const shift of monday) {
    assert.equal(shift.start, '20:00')
    assert.equal(shift.end, '26:00', 'a 2am finish is 26:00 on the day the shift starts')
    assert.equal(shift.hours, 6)
  }
})

test('coverage rules and availability work across midnight', () => {
  const settings = { operatingHours: open('20:00', '02:00') }

  const covered = runScheduler(
    [person('Ava', 'Bartender', 30), person('Bo', 'Bartender', 30)],
    settings,
    '2026-05-04',
    { slots: [{ start: '22:00', end: '02:00', role: 'Bartender', count: 2, days: 'all' }] },
  )
  assert.equal(covered.days.monday.emptySlots.length, 0, 'a 22:00-02:00 rule should be fillable')
  assert.equal(covered.days.monday.shifts.length, 2)

  // Availability written as crossing midnight resolves onto the same night.
  const crossing = runScheduler(
    [person('Ava', 'Bartender', 30, { available: true, start: '20:00', end: '02:00' })],
    settings, '2026-05-04', {},
  )
  assert.equal(crossing.days.monday.shifts[0].end, '26:00')

  // Someone only free during the day is never put on a night shift.
  const daytimeOnly = runScheduler(
    [person('Ava', 'Bartender', 30, { available: true, start: '09:00', end: '17:00' })],
    settings, '2026-05-04', {},
  )
  assert.equal(allShifts(daytimeOnly).length, 0)

  // Small-hours availability belongs to the night that is already running.
  const smallHours = runScheduler(
    [person('Ava', 'Bartender', 30, { available: true, start: '00:00', end: '06:00' })],
    { operatingHours: open('20:00', '04:00') }, '2026-05-04', {},
  )
  assert.equal(smallHours.days.monday.shifts[0].start, '24:00')
  assert.equal(smallHours.days.monday.shifts[0].end, '28:00')
})

test('a trading day shorter than a full shift still gets covered', () => {
  // The daily budget used to be all-or-nothing, so a window shorter than it
  // produced no shift at all.
  const result = runScheduler(
    [person('Ava', 'Barista', 40)],
    { operatingHours: open('09:00', '15:00') },
    '2026-05-04',
    {},
  )
  const monday = result.days.monday.shifts
  assert.equal(monday.length, 1)
  assert.equal(monday[0].hours, 6)
})

test('daytime hours are unaffected by overnight support', () => {
  const result = runScheduler(
    [person('Ava', 'Barista', 30)],
    { operatingHours: open('08:00', '18:00') },
    '2026-05-04',
    {},
  )
  for (const shift of allShifts(result)) {
    assert.ok(toMins(shift.end, true) <= 18 * 60, `${shift.end} runs past closing`)
  }

  // Open 00:00 to 00:00 is a 24-hour day, not an overnight one.
  const roundTheClock = runScheduler(
    [person('Bo', 'Barista', 40)],
    { operatingHours: open('00:00', '00:00') },
    '2026-05-04',
    {},
  )
  for (const shift of allShifts(roundTheClock)) {
    assert.ok(toMins(shift.end, true) <= 24 * 60, `${shift.end} runs past midnight`)
  }
})
