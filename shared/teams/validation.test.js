import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAssignment } from './validation.js'
import { resolveShiftTimes } from './time.js'

const TZ = 'America/Los_Angeles'
const now = new Date('2026-10-20T12:00:00Z')

function shift(id, date, start, end, extra = {}) {
  const r = resolveShiftTimes({ date, start, end, timezone: TZ })
  if (!r.ok) throw new Error(r.message)
  return { id, ...r.value, status: 'scheduled', ...extra }
}

const ana = { name: 'Ana', uid: 'ana', active: true }
const codes = (result) => result.problems.map(p => p.code)

test('a free person with no limits can take a future shift', () => {
  const r = checkAssignment({ shift: shift('s', '2026-10-22', '09:00', '17:00'), person: ana, now })
  assert.deepEqual(r, { ok: true, problems: [] })
})

test('overlaps in this workplace and elsewhere are caught, worded for the reader', () => {
  const target = shift('s', '2026-10-22', '09:00', '17:00')
  const mine = [shift('m1', '2026-10-22', '16:00', '20:00')]
  const away = [{ shiftId: 'x', startAt: new Date('2026-10-22T17:30:00Z'), endAt: new Date('2026-10-22T19:00:00Z') }]
  const self = checkAssignment({ shift: target, person: ana, sameBusinessShifts: mine, otherWorkplaceBlocks: away, now })
  assert.deepEqual(codes(self), ['conflict', 'conflict_elsewhere'])
  assert.match(self.problems[0].message, /^You already work 4pm – 8pm on Thu, Oct 22/)
  assert.match(self.problems[1].message, /another workplace/)
  const manager = checkAssignment({ shift: target, person: ana, sameBusinessShifts: mine, otherWorkplaceBlocks: away, now, audience: 'manager' })
  assert.match(manager.problems[1].message, /^Ana has another commitment/)
  assert.doesNotMatch(manager.problems[1].message, /workplace/)
})

test('the shift being swapped away does not count against the person taking the other', () => {
  const target = shift('theirs', '2026-10-22', '09:00', '17:00')
  const mine = [shift('mine', '2026-10-22', '09:00', '17:00')]
  assert.equal(checkAssignment({ shift: target, person: ana, sameBusinessShifts: mine, now }).ok, false)
  assert.equal(checkAssignment({ shift: target, person: ana, sameBusinessShifts: mine, now, excludeShiftIds: ['mine'] }).ok, true)
})

test('rest, daily and weekly limits come from the business policy', () => {
  const target = shift('s', '2026-10-22', '07:00', '15:00')
  const lateBefore = [shift('m1', '2026-10-21', '18:00', '23:00')]
  const policies = { minRestHours: 10, maxHoursPerDay: 10, maxHoursPerWeek: 20 }
  assert.deepEqual(codes(checkAssignment({ shift: target, person: ana, sameBusinessShifts: lateBefore, policies, now })), ['rest'])

  const sameDay = [shift('m2', '2026-10-22', '16:00', '19:00')]
  assert.ok(codes(checkAssignment({ shift: target, person: ana, sameBusinessShifts: sameDay, policies: { maxHoursPerDay: 10 }, now })).includes('max_day'))

  const week = [shift('a', '2026-10-19', '09:00', '17:00'), shift('b', '2026-10-20', '15:00', '20:00')]
  const r = checkAssignment({ shift: target, person: ana, sameBusinessShifts: week, policies: { maxHoursPerWeek: 20 }, now })
  assert.deepEqual(codes(r), ['max_week'])
  assert.match(r.problems[0].message, /21h that week, over the 20-hour/)
  // Last week's hours do not count.
  const lastWeek = [shift('c', '2026-10-15', '09:00', '23:00')]
  assert.equal(checkAssignment({ shift: target, person: ana, sameBusinessShifts: lastWeek, policies: { maxHoursPerWeek: 20 }, now }).ok, true)
})

test('timing: started shifts and the cut-off', () => {
  assert.deepEqual(codes(checkAssignment({ shift: shift('s', '2026-10-20', '04:00', '06:00'), person: ana, now })), ['started'])
  const soon = shift('s', '2026-10-20', '06:00', '09:00') // 13:00Z, an hour away
  assert.deepEqual(codes(checkAssignment({ shift: soon, person: ana, now, policies: { offerCutoffHours: 2 } })), ['too_late'])
  assert.equal(checkAssignment({ shift: soon, person: ana, now, policies: { offerCutoffHours: 0 } }).ok, true)
})

test('positions apply only when both sides name them; cancelled shifts never clash', () => {
  const barista = shift('s', '2026-10-22', '09:00', '17:00', { positionName: 'Barista' })
  assert.deepEqual(codes(checkAssignment({ shift: barista, person: { ...ana, positionNames: ['Floor'] }, now })), ['position'])
  assert.equal(checkAssignment({ shift: barista, person: { ...ana, positionNames: ['barista'] }, now }).ok, true)
  assert.equal(checkAssignment({ shift: barista, person: ana, now }).ok, true)
  const cancelled = [shift('m', '2026-10-22', '09:00', '17:00', { status: 'cancelled' })]
  assert.equal(checkAssignment({ shift: barista, person: ana, sameBusinessShifts: cancelled, now }).ok, true)
})

test('people who left or never joined cannot take shifts', () => {
  const s = shift('s', '2026-10-22', '09:00', '17:00')
  assert.deepEqual(codes(checkAssignment({ shift: s, person: { name: 'Jo', active: true }, now })), ['no_account'])
  assert.deepEqual(codes(checkAssignment({ shift: s, person: { ...ana, active: false }, now })), ['not_member'])
})
