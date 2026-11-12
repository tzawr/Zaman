import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dateForDay, defaultWeekStart, formatDayDate, formatWeekRange, isMonday, normalizeWeekStart, scheduleDateProblem, weekDayDates, weekdayName } from './weekDates.js'

// HQA-08. The default week used local-date math written out in UTC, so the
// answer depended on the hour and the time zone.

test('the default week is next Monday in the manager\'s own calendar, at any hour and in any zone', () => {
  const cases = [
    // [instant (UTC), time zone, expected Monday]
    ['2026-11-11T05:30:00Z', 'America/Los_Angeles', '2026-11-16'], // Tue 21:30 — the audit (was 2026-11-17)
    ['2026-11-10T07:59:00Z', 'America/Los_Angeles', '2026-11-16'], // Mon 23:59
    ['2026-11-10T08:00:00Z', 'America/Los_Angeles', '2026-11-16'], // Tue 00:00
    ['2026-11-16T07:30:00Z', 'America/Los_Angeles', '2026-11-16'], // Sun 23:30 → tomorrow
    ['2026-11-16T08:30:00Z', 'America/Los_Angeles', '2026-11-23'], // Mon 00:30 → next week's Monday
    ['2026-11-10T20:30:00Z', 'Pacific/Auckland', '2026-11-16'], // Wed 09:30 UTC+13 (was 2026-11-15)
    ['2026-11-15T10:30:00Z', 'Pacific/Kiritimati', '2026-11-23'], // Mon 00:30 UTC+14
    ['2026-11-11T05:30:00Z', 'Asia/Kolkata', '2026-11-16'], // UTC+5:30
    ['2026-11-11T05:30:00Z', 'UTC', '2026-11-16'],
    ['2026-12-29T23:30:00Z', 'Europe/London', '2027-01-04'], // year boundary
    ['2026-12-31T23:30:00Z', 'America/New_York', '2027-01-04'], // Dec 31 local, Jan 1 UTC
    ['2026-11-01T06:30:00Z', 'America/Los_Angeles', '2026-11-02'], // DST ends that night
    ['2027-03-08T06:30:00Z', 'America/Los_Angeles', '2027-03-08'], // DST began that morning
    ['2027-02-27T12:00:00Z', 'UTC', '2027-03-01'], // month boundary, non-leap February
    ['2028-02-27T12:00:00Z', 'UTC', '2028-02-28'], // leap year
  ]
  for (const [now, tz, monday] of cases) {
    const got = defaultWeekStart(new Date(now), tz)
    assert.equal(got, monday, `${now} in ${tz}`)
    assert.equal(isMonday(got), true)
  }
})

test('any picked date becomes the Monday of its week; a Monday stays', () => {
  assert.equal(normalizeWeekStart('2026-11-23'), '2026-11-23')
  for (const d of ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']) assert.equal(normalizeWeekStart(d), '2026-11-23', d)
  assert.equal(normalizeWeekStart('2027-01-01'), '2026-12-28')
  assert.equal(normalizeWeekStart('2026-03-01'), '2026-02-23')
  for (const bad of ['', null, '2026-02-30', '17/11/2026', 'nope']) assert.equal(normalizeWeekStart(bad), null, String(bad))
})

test('the seven dates of a week, and their weekday names, agree', () => {
  const dates = weekDayDates('2026-12-28')
  assert.deepEqual(dates, ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
  assert.deepEqual(dates.map(weekdayName), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  assert.equal(dateForDay('2026-11-02', 6), '2026-11-08') // across the US DST change
})

test('labels are the same calendar date in every time zone', () => {
  assert.equal(formatDayDate('2026-11-16'), 'Nov 16')
  assert.equal(formatWeekRange('2026-11-16'), 'Nov 16 — Nov 22, 2026')
  assert.equal(formatWeekRange('2026-12-28'), 'Dec 28, 2026 — Jan 3, 2027')
  assert.equal(formatWeekRange('bad'), '')
  assert.match(formatWeekRange('2026-11-16', 'fa'), /2026|۲۰۲۶|1405/)
})

test('saved records with a non-Monday start or shifted dates are recognised, not rewritten', () => {
  const week = (start) => ({ days: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((k, i) => [k, { date: weekDayDates(start)[i], shifts: [] }])) })
  assert.equal(scheduleDateProblem('2026-11-16', week('2026-11-16')), null)
  const audit = scheduleDateProblem('2026-11-17', week('2026-11-17'))
  assert.equal(audit.kind, 'not_monday')
  assert.equal(audit.savedWeekday, 'Tuesday')
  assert.equal(audit.monday, '2026-11-16')
  // UTC+13: Monday week start, but every day dated one day early.
  const early = { days: Object.fromEntries(Object.entries(week('2026-11-15').days).map(([k, v]) => [k, v])) }
  assert.equal(scheduleDateProblem('2026-11-16', early).kind, 'dates_mismatch')
  assert.equal(scheduleDateProblem('', {}).kind, 'invalid')
  // Old records without per-day dates are fine when they start on a Monday.
  assert.equal(scheduleDateProblem('2026-11-16', { days: { monday: { shifts: [] } } }), null)
})
