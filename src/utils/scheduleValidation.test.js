import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverageGaps, revalidateSchedule, validateSchedule } from './scheduleValidation.js'

// HQA-09: Monday needs 2 people 07:00–15:00. Mira and Theo both work it,
// then Theo's start is moved to 08:00 by hand.
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const every = (v) => Object.fromEntries(DAYS.map(d => [d, { ...v }]))
const workspace = {
  operatingHours: { ...every({ open: false }), monday: { open: true, start: '07:00', end: '15:00' } },
  coverage: { ...every({ minPeople: 0 }), monday: { minPeople: 2 } },
}
const person = (name) => ({ name, role: 'Barista', targetHours: 8, availability: every({ available: true, start: '', end: '' }), timeOff: [] })
const team = [person('Mira'), person('Theo')]
const week = (theoStart) => ({
  weekStart: '2026-11-16',
  checkedRules: null,
  issues: [],
  recommendations: [],
  days: {
    ...Object.fromEntries(DAYS.map((d, i) => [d, { date: `2026-11-${16 + i}`, shifts: [] }])),
    monday: { date: '2026-11-16', shifts: [
      { employee: 'Mira', role: 'Barista', start: '07:00', end: '15:00', hours: 8 },
      { employee: 'Theo', role: 'Barista', start: theoStart, end: '15:00', hours: theoStart === '07:00' ? 8 : 7 },
    ] },
  },
})

test('a fully covered day has no review items', () => {
  assert.deepEqual(validateSchedule(week('07:00'), team, null, workspace), [])
})

test('the audit: a late start leaves 07:00–08:00 short, and the check says so with the interval', () => {
  const issues = validateSchedule(week('08:00'), team, null, workspace)
  assert.ok(issues.includes('Monday: needs 2 staff from 07:00–08:00 — only 1 on shift'), issues.join('\n'))
})

test('revalidating a manual edit replaces the review items and is never Ready when short', () => {
  const edited = revalidateSchedule({ ...week('08:00'), issues: [], recommendations: ['old advice'] }, team, workspace)
  assert.ok(edited.issues.some(i => /07:00–08:00/.test(i)))
  assert.deepEqual(edited.recommendations, [], 'advice written for other issues is dropped')
  assert.equal(edited.summary.find(r => r.employee === 'Theo').scheduledHours, 7)
  // Fixing it again clears the item.
  const fixed = revalidateSchedule(week('07:00'), team, workspace)
  assert.deepEqual(fixed.issues, [])
})

test('deleting a shift or reassigning to someone unavailable is caught', () => {
  const w = week('07:00'); w.days.monday.shifts.pop()
  assert.match(revalidateSchedule(w, team, workspace).issues.join('\n'), /needs 2 staff from 07:00–15:00 — only 1 on shift/)
  const off = [person('Mira'), { ...person('Theo'), availability: { ...every({ available: true }), monday: { available: false } } }]
  assert.match(revalidateSchedule(week('07:00'), off, workspace).issues.join('\n'), /Monday: Theo is not available/)
})

test('a shift on approved time off is a review item', () => {
  const away = [person('Mira'), { ...person('Theo'), timeOff: [{ start: '2026-11-16', end: '2026-11-18' }] }]
  assert.match(validateSchedule(week('07:00'), away, null, workspace).join('\n'), /Theo has approved time off on 2026-11-16/)
})

test('older weeks saved without their rules keep earlier review items', () => {
  const legacy = { ...week('07:00'), issues: ['Monday: needs 1 closer(s) ending at or after 15:00 — only 0 found'] }
  delete legacy.checkedRules
  assert.deepEqual(revalidateSchedule(legacy, team, workspace).issues, legacy.issues)
})

test('coverage gaps across midnight use the same extended timeline as shifts', () => {
  const bar = { open: true, start: '20:00', end: '02:00' }
  assert.deepEqual(coverageGaps([{ start: '20:00', end: '26:00' }], bar, 1), [])
  assert.deepEqual(coverageGaps([{ start: '20:00', end: '24:00' }], bar, 1), [{ from: 1440, to: 1560, count: 0 }])
  assert.deepEqual(coverageGaps([], { open: true, start: '09:00', end: '17:00' }, 1), [{ from: 540, to: 1020, count: 0 }])
})

test('HQA-12: a day off on approved time off is not offered as unused availability', () => {
  const theo = { ...person('Theo'), availability: { ...every({ available: false }), monday: { available: true, start: '', end: '' } }, timeOff: [{ start: '2026-11-16', end: '2026-11-16' }] }
  const w = week('07:00'); w.days.monday.shifts = w.days.monday.shifts.filter(s => s.employee !== 'Theo')
  const issues = validateSchedule(w, [person('Mira'), theo], null, workspace)
  const target = issues.find(i => i.startsWith('Theo:'))
  assert.match(target, /no unused available days remain/)
  assert.doesNotMatch(target, /add shifts on/)
})
