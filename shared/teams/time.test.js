import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays, formatShiftRange, formatTime12, isDateString, monthGrid, parseTime, relativeDay,
  resolveShiftTimes, weekStartOf, weekdayIndex, zonedParts, zonedToUtc,
} from './time.js'

const LA = 'America/Los_Angeles'

test('calendar dates', () => {
  assert.ok(isDateString('2026-02-28'))
  assert.equal(isDateString('2026-02-30'), false)
  assert.equal(isDateString('26-02-01'), false)
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2028-03-01', -1), '2028-02-29')
  assert.equal(weekdayIndex('2026-10-19'), 0) // a Monday
  assert.equal(weekStartOf('2026-10-25'), '2026-10-19') // Sunday belongs to the week before
  assert.equal(weekStartOf('2026-10-19'), '2026-10-19')
})

test('a month grid is whole Monday-to-Sunday weeks covering the month', () => {
  const grid = monthGrid(2026, 1) // February 2026 starts on a Sunday
  assert.equal(grid[0][0], '2026-01-26')
  assert.equal(grid[0][6], '2026-02-01')
  assert.equal(grid.at(-1).at(-1) >= '2026-02-28', true)
  for (const week of grid) assert.equal(week.length, 7)
})

test('times parse strictly', () => {
  assert.equal(parseTime('9:05'), 545)
  assert.equal(parseTime('23:59'), 1439)
  assert.equal(parseTime('24:00'), null)
  assert.equal(parseTime('9am'), null)
  assert.equal(formatTime12(0), '12am')
  assert.equal(formatTime12(12 * 60 + 30), '12:30pm')
})

test('local times convert to the right instant across zones', () => {
  assert.equal(zonedToUtc('2026-07-01', 9 * 60, LA).toISOString(), '2026-07-01T16:00:00.000Z') // PDT, -7
  assert.equal(zonedToUtc('2026-12-01', 9 * 60, LA).toISOString(), '2026-12-01T17:00:00.000Z') // PST, -8
  assert.equal(zonedToUtc('2026-07-01', 9 * 60, 'Asia/Kolkata').toISOString(), '2026-07-01T03:30:00.000Z')
  assert.equal(zonedToUtc('2026-07-01', 0, 'UTC').toISOString(), '2026-07-01T00:00:00.000Z')
})

test('the spring-forward gap and the fall-back repeat', () => {
  // 2026-03-08 02:30 does not exist in Los Angeles; it reads as 03:30 PDT.
  const gap = zonedToUtc('2026-03-08', 2 * 60 + 30, LA)
  assert.equal(gap.toISOString(), '2026-03-08T10:30:00.000Z')
  assert.deepEqual(zonedParts(gap, LA), { date: '2026-03-08', minutes: 3 * 60 + 30, seconds: 0 })
  // 2026-11-01 01:30 happens twice; the first (PDT) is taken.
  assert.equal(zonedToUtc('2026-11-01', 90, LA).toISOString(), '2026-11-01T08:30:00.000Z')
})

test('an overnight shift across the fall-back change is an hour longer', () => {
  const r = resolveShiftTimes({ date: '2026-10-31', start: '22:00', end: '06:00', timezone: LA })
  assert.ok(r.ok)
  assert.equal(r.value.overnight, true)
  assert.equal(r.value.minutes, 9 * 60)
  assert.equal(formatShiftRange(r.value), '10pm – 6am (+1)')
})

test('a spring-forward overnight is an hour shorter', () => {
  const r = resolveShiftTimes({ date: '2026-03-07', start: '22:00', end: '06:00', timezone: LA })
  assert.equal(r.value.minutes, 7 * 60)
})

test('shift validation explains itself', () => {
  assert.equal(resolveShiftTimes({ date: 'x', start: '09:00', end: '17:00', timezone: LA }).ok, false)
  assert.match(resolveShiftTimes({ date: '2026-10-20', start: '9', end: '17:00', timezone: LA }).message, /start time/)
  assert.match(resolveShiftTimes({ date: '2026-10-20', start: '09:00', end: '09:00', timezone: LA }).message, /end after/)
  assert.match(resolveShiftTimes({ date: '2026-10-20', start: '06:00', end: '23:00', timezone: LA }).message, /at most 16/)
})

test('relative days', () => {
  assert.equal(relativeDay('2026-10-20', '2026-10-20'), 'Today')
  assert.equal(relativeDay('2026-10-21', '2026-10-20'), 'Tomorrow')
  assert.equal(relativeDay('2026-10-24', '2026-10-20'), 'Sat, Oct 24')
})

test('time entry accepts the ways people type a time', async () => {
  const { normalizeTimeInput } = await import('./time.js')
  const cases = { '9': '09:00', '930': '09:30', '9:30': '09:30', '9.30pm': '21:30', '12am': '00:00', '12pm': '12:00',
    '21:00': '21:00', ' 7 PM ': '19:00', '0': '00:00' }
  for (const [input, want] of Object.entries(cases)) assert.equal(normalizeTimeInput(input), want, input)
  for (const bad of ['25', '13pm', '9:75', 'noon', '', '1234567']) assert.equal(normalizeTimeInput(bad), null, bad)
})
