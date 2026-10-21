import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  availabilityOn, availabilityProblem, describeTimeOff, summarizeWeekly, timeOffClash, upcomingVersion,
  validateOverride, validateTimeOff, validateWeekly, versionOn, withVersion,
} from './availability.js'

const weekdays = (windows) => Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map(d => [d, { available: true, windows }]))

test('a weekly pattern is normalised, with every day explicit', () => {
  const r = validateWeekly({ ...weekdays([{ start: '9', end: '5pm' }]), saturday: { available: true, windows: [] } })
  assert.ok(r.ok)
  assert.deepEqual(r.value.monday, { available: true, windows: [{ start: '09:00', end: '17:00' }] })
  assert.deepEqual(r.value.saturday, { available: true, windows: [{ start: '00:00', end: '00:00' }] }) // all day
  assert.deepEqual(r.value.sunday, { available: false, windows: [] })
})

test('bad patterns are explained', () => {
  assert.match(validateWeekly({ monday: { available: true, windows: [{ start: 'nine', end: '17:00' }] } }).message, /^Mon:/)
  assert.match(validateWeekly({ friday: { available: true, windows: [{ start: '9', end: '13' }, { start: '12', end: '17' }] } }).message, /overlap/)
  assert.match(validateWeekly({ monday: { available: true, windows: [1, 2, 3] } }).message, /at most 2/)
})

test('summaries group days with the same hours', () => {
  const weekly = validateWeekly({
    ...weekdays([{ start: '09:00', end: '17:00' }]),
    saturday: { available: true, windows: [{ start: '10:00', end: '14:00' }] },
  }).value
  assert.equal(summarizeWeekly(weekly), 'Mon–Fri 9am–5pm · Sat 10am–2pm')
  assert.equal(summarizeWeekly(validateWeekly({}).value), 'Not available any day')
  assert.equal(summarizeWeekly(validateWeekly({ sunday: { available: true } }).value), 'Sun all day')
})

test('a change entered now applies from its effective date; old versions are pruned', () => {
  const v1 = { effectiveFrom: '2026-01-01', weekly: validateWeekly(weekdays([])).value }
  const v2 = { effectiveFrom: '2026-10-26', weekly: validateWeekly({}).value }
  const a = { versions: withVersion([v1], v2, '2026-10-20') }
  assert.equal(versionOn(a, '2026-10-25').effectiveFrom, '2026-01-01')
  assert.equal(versionOn(a, '2026-10-26').effectiveFrom, '2026-10-26')
  assert.equal(upcomingVersion(a, '2026-10-20').effectiveFrom, '2026-10-26')
  const later = withVersion(a.versions, { ...v2, effectiveFrom: '2026-11-02' }, '2026-10-30')
  assert.deepEqual(later.map(v => v.effectiveFrom), ['2026-10-26', '2026-11-02'])
})

test('temporary changes override the weekly pattern for their dates', () => {
  const a = {
    versions: [{ effectiveFrom: '2026-01-01', weekly: validateWeekly(weekdays([{ start: '09:00', end: '17:00' }])).value }],
    overrides: [validateOverride({ from: '2026-10-22', to: '2026-10-23', unavailable: true, reason: 'Exams' }, '2026-10-20').value],
  }
  assert.equal(availabilityOn(a, '2026-10-21').available, true)
  assert.equal(availabilityOn(a, '2026-10-22').available, false)
  assert.equal(availabilityOn(a, '2026-10-24').available, false) // Saturday, not in the pattern
  assert.equal(availabilityOn(null, '2026-10-24'), null)
  assert.match(validateOverride({ from: '2026-10-01', to: '2026-10-02' }, '2026-10-20').message, /passed/)
})

test('a shift outside availability is described for the manager', () => {
  const a = { versions: [{ effectiveFrom: '2026-01-01', weekly: validateWeekly(weekdays([{ start: '09:00', end: '17:00' }])).value }] }
  const shift = (date, startLocal, endLocal) => ({ date, startLocal, endLocal })
  assert.equal(availabilityProblem(shift('2026-10-21', '09:00', '17:00'), a), null)
  assert.equal(availabilityProblem(shift('2026-10-21', '08:00', '17:00'), a), 'is available 9am–5pm on Wed, Oct 21')
  assert.equal(availabilityProblem(shift('2026-10-24', '09:00', '17:00'), a), 'is not available on Sats')
  assert.equal(availabilityProblem(shift('2026-10-24', '09:00', '17:00'), null), null)
  // An overnight window covers an overnight shift.
  const nights = { versions: [{ effectiveFrom: '2026-01-01', weekly: validateWeekly({ friday: { available: true, windows: [{ start: '20:00', end: '03:00' }] } }).value }] }
  assert.equal(availabilityProblem(shift('2026-10-23', '21:00', '02:00'), nights), null)
})

test('time off requests are checked and described', () => {
  const ctx = { today: '2026-10-20', categories: ['vacation', 'sick', 'personal', 'unpaid'] }
  const full = validateTimeOff({ category: 'vacation', startDate: '2026-10-26', endDate: '2026-10-30' }, ctx)
  assert.ok(full.ok)
  assert.equal(describeTimeOff(full.value), 'Mon, Oct 26 – Fri, Oct 30 · 5 days')
  const part = validateTimeOff({ category: 'personal', startDate: '2026-10-22', endDate: '2026-10-22', partialStart: '1pm', partialEnd: '5pm' }, ctx)
  assert.equal(describeTimeOff(part.value), 'Thu, Oct 22, 1pm–5pm')
  assert.match(validateTimeOff({ category: 'beach', startDate: '2026-10-26', endDate: '2026-10-26' }, ctx).message, /kind/)
  assert.match(validateTimeOff({ category: 'sick', startDate: '2026-10-19', endDate: '2026-10-19' }, ctx).message, /today or later/)
  assert.match(validateTimeOff({ category: 'sick', startDate: '2026-10-22', endDate: '2026-10-23', partialStart: '9', partialEnd: '12' }, ctx).message, /single day/)
  assert.match(validateTimeOff({ category: 'sick', startDate: '2026-10-22', endDate: '2027-01-30' }, ctx).message, /60 days/)
})

test('time off clashes with shifts on its days, including the tail of an overnight', () => {
  const off = { startDate: '2026-10-22', endDate: '2026-10-22', partial: null }
  const afternoon = { startDate: '2026-10-22', endDate: '2026-10-22', partial: { start: '13:00', end: '17:00' } }
  const shift = (date, startLocal, endLocal) => ({ date, startLocal, endLocal })
  assert.equal(timeOffClash(shift('2026-10-22', '09:00', '17:00'), off), true)
  assert.equal(timeOffClash(shift('2026-10-21', '22:00', '06:00'), off), true) // runs into the day off
  assert.equal(timeOffClash(shift('2026-10-23', '09:00', '17:00'), off), false)
  assert.equal(timeOffClash(shift('2026-10-22', '07:00', '12:00'), afternoon), false)
  assert.equal(timeOffClash(shift('2026-10-22', '07:00', '14:00'), afternoon), true)
})
