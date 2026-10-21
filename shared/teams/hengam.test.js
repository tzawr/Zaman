import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTeamsToHengamEmployees, desiredShiftsFromHengam, hengamAvailabilityForWeek, hengamSlotMatches,
  hengamTimeOff, hengamTimesToWall, publishFingerprint,
} from './hengam.js'
import { validateWeekly } from './availability.js'

const employees = [{ id: 'e1', name: 'Ana Lima', role: 'Barista' }, { id: 'e2', name: 'Ben' }]
const data = {
  days: {
    monday: { date: '2026-10-26', shifts: [{ employee: 'Ana Lima', role: 'Barista', start: '07:00', end: '15:00' }] },
    friday: { date: '2026-10-30', shifts: [
      { employee: 'ben', start: '20:00', end: '26:00' },
      { employee: 'Ana Lima', start: '09:00', end: '13:00' },
    ] },
  },
}

test('Hengam’s overnight 26:00 becomes a next-morning wall time', () => {
  assert.deepEqual(hengamTimesToWall('20:00', '26:00'), { start: '20:00', end: '02:00' })
  assert.deepEqual(hengamTimesToWall('16:00', '24:00'), { start: '16:00', end: '00:00' })
  assert.equal(hengamTimesToWall('9am', '17:00'), null)
  assert.equal(hengamTimesToWall('09:00', '49:00'), null)
})

test('a Hengam week maps to Teams shifts with slot ids, matching names case-insensitively', () => {
  const { errors, shifts } = desiredShiftsFromHengam({ scheduleId: 's1', weekStart: '2026-10-26', data, employees })
  assert.deepEqual(errors, [])
  assert.deepEqual(shifts.map(s => s.id), ['h_2026-10-26_monday_0', 'h_2026-10-26_friday_0', 'h_2026-10-26_friday_1'])
  assert.deepEqual(shifts[1], {
    id: 'h_2026-10-26_friday_0', staffId: 'e2', staffName: 'Ben', positionName: null,
    date: '2026-10-30', start: '20:00', end: '02:00', hengamRef: { scheduleId: 's1', day: 'friday', index: 0 },
  })
  assert.equal(shifts[0].positionName, 'Barista')
})

test('unknown and ambiguous names stop the publish with a reason', () => {
  const twoBens = [...employees, { id: 'e3', name: 'BEN' }]
  const r1 = desiredShiftsFromHengam({ scheduleId: 's', weekStart: '2026-10-26', data, employees: twoBens })
  assert.match(r1.errors[0], /Two employees are called “ben”/)
  const r2 = desiredShiftsFromHengam({ scheduleId: 's', weekStart: '2026-10-26', data, employees: employees.slice(0, 1) })
  assert.match(r2.errors[0], /No employee named “ben”/)
})

test('the fingerprint ignores order and notices any change', () => {
  const { shifts } = desiredShiftsFromHengam({ scheduleId: 's1', weekStart: '2026-10-26', data, employees })
  assert.equal(publishFingerprint(shifts), publishFingerprint([...shifts].reverse()))
  assert.notEqual(publishFingerprint(shifts), publishFingerprint([{ ...shifts[0], end: '16:00' }, ...shifts.slice(1)]))
})

test('Teams availability becomes Hengam’s, day by day, including temporary changes', () => {
  const weekly = validateWeekly({
    monday: { available: true, windows: [{ start: '9', end: '13' }, { start: '17', end: '21' }] },
    tuesday: { available: true },
    friday: { available: true, windows: [{ start: '20:00', end: '03:00' }] },
  }).value
  const a = { versions: [{ effectiveFrom: '2026-01-01', weekly }], overrides: [{ from: '2026-10-30', to: '2026-10-30', unavailable: true, windows: [] }] }
  const h = hengamAvailabilityForWeek(a, '2026-10-26')
  assert.deepEqual(h.monday, { available: true, start: '09:00', end: '21:00' })
  assert.deepEqual(h.tuesday, { available: true })
  assert.deepEqual(h.wednesday, { available: false })
  assert.deepEqual(h.friday, { available: false }) // the temporary change wins
  assert.equal(hengamAvailabilityForWeek(null, '2026-10-26'), null)
})

test('only approved time off reaches Hengam, and Teams entries replace earlier Teams entries', () => {
  const requests = [
    { id: 'a', status: 'approved', startDate: '2026-10-27', endDate: '2026-10-28', reason: 'Trip' },
    { id: 'b', status: 'pending', startDate: '2026-10-30', endDate: '2026-10-30' },
    { id: 'c', status: 'approved', startDate: '2026-10-29', endDate: '2026-10-29', partial: { start: '13:00', end: '17:00' } },
  ]
  assert.deepEqual(hengamTimeOff(requests).map(t => [t.id, t.start, t.end]), [['teams-a', '2026-10-27', '2026-10-28'], ['teams-c', '2026-10-29', '2026-10-29']])
  const [ana] = applyTeamsToHengamEmployees(
    [{ id: 'e1', name: 'Ana', timeOff: [{ id: 'old', start: '2026-01-01', end: '2026-01-02' }, { id: 'teams-x', source: 'teams' }] }],
    { availabilityByStaffId: {}, timeOffByStaffId: { e1: requests }, weekStart: '2026-10-26' },
  )
  assert.deepEqual(ana.timeOff.map(t => t.id), ['old', 'teams-a', 'teams-c'])
  const untouched = { id: 'e2', name: 'Ben', availability: { monday: { available: true } } }
  assert.equal(applyTeamsToHengamEmployees([untouched], { availabilityByStaffId: {}, timeOffByStaffId: {}, weekStart: '2026-10-26' })[0], untouched)
})

test('a transfer only writes back over the slot it was agreed on', () => {
  const slot = { employee: 'Ana Lima', start: '20:00', end: '26:00' }
  assert.equal(hengamSlotMatches(slot, { staffName: 'ana lima', startLocal: '20:00', endLocal: '02:00' }), true)
  assert.equal(hengamSlotMatches(slot, { staffName: 'Ana Lima', startLocal: '19:00', endLocal: '02:00' }), false)
  assert.equal(hengamSlotMatches(undefined, { staffName: 'Ana Lima' }), false)
})
