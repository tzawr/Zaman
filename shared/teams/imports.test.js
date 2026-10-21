import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  interpretTable, matchStaff, parseCsv, prepareRows, readDate, readTime, readTimeRange, weekdayOf,
} from './imports.js'

test('CSV: quotes, embedded delimiters, CRLF, and the delimiter guessed', () => {
  assert.deepEqual(parseCsv('Name,Note\r\n"Lima, Ana","said ""hi"""\r\n'), [['Name', 'Note'], ['Lima, Ana', 'said "hi"']])
  assert.deepEqual(parseCsv('Name;Start\nAna;09:00\n'), [['Name', 'Start'], ['Ana', '09:00']])
  assert.deepEqual(parseCsv('Name\tStart\nAna\t9\n\n'), [['Name', 'Start'], ['Ana', '9']])
})

test('dates as spreadsheets hold them', () => {
  const y = { year: 2026, weekStart: '2026-10-26' }
  assert.deepEqual(readDate('2026-10-27'), { date: '2026-10-27', sure: true })
  assert.deepEqual(readDate('46322'), { date: '2026-10-27', sure: true }) // Excel serial
  assert.deepEqual(readDate('10/27/2026'), { date: '2026-10-27', sure: true })
  assert.deepEqual(readDate('27/10/2026'), { date: '2026-10-27', sure: true })
  assert.deepEqual(readDate('03/04/2026'), { date: '2026-03-04', sure: false }) // could be either
  assert.deepEqual(readDate('Oct 27', y), { date: '2026-10-27', sure: true })
  assert.deepEqual(readDate('27 October 2026'), { date: '2026-10-27', sure: true })
  assert.deepEqual(readDate('Tue', y), { date: '2026-10-27', sure: true })
  assert.equal(readDate('soon', y), null)
  assert.equal(weekdayOf('Thu.'), 3)
  assert.equal(weekdayOf('x'), null)
})

test('times and ranges, including the bare 9-5', () => {
  assert.equal(readTime('0.375'), '09:00')
  assert.equal(readTime('9:30 p.m.'), '21:30')
  assert.deepEqual(readTimeRange('9am-5pm'), { start: '09:00', end: '17:00', sure: true })
  assert.deepEqual(readTimeRange('09:00–17:00'), { start: '09:00', end: '17:00', sure: true })
  assert.deepEqual(readTimeRange('9-5'), { start: '09:00', end: '17:00', sure: false })
  assert.deepEqual(readTimeRange('22:00 to 02:00'), { start: '22:00', end: '02:00', sure: true })
  assert.equal(readTimeRange('all day'), null)
})

test('a list layout: one shift per row', () => {
  const table = parseCsv([
    'Employee,Date,Start,End,Role',
    'Ana Lima,2026-10-27,7:00,15:00,Barista',
    'Ben,10/28/2026,11am,7pm,',
    'Cal,?,9,5,',
  ].join('\n'))
  const { layout, rows, problems } = interpretTable(table, { weekStart: '2026-10-26' })
  assert.equal(layout, 'list')
  assert.deepEqual(problems, [])
  assert.deepEqual(rows[0], { name: 'Ana Lima', date: '2026-10-27', start: '07:00', end: '15:00', positionName: 'Barista', location: null, raw: undefined, sure: { name: true, date: true, times: true } })
  assert.equal(rows[1].end, '19:00')
  // 9 and 5 in separate columns read as nine to five, marked for checking
  assert.deepEqual([rows[2].start, rows[2].end, rows[2].sure.times], ['09:00', '17:00', false])
  assert.equal(rows[2].date, null)
  assert.ok(rows[2].raw.includes('Cal'))
})

test('a grid layout: people down, days across, with offs and split shifts', () => {
  const table = parseCsv([
    'Staff,Mon,Tue,Wed,Thu,Fri',
    'Ana,9-5,OFF,,7am-3pm,',
    'Ben,,"10-2 / 5-9",,,"22:00-02:00"',
  ].join('\n'))
  const { layout, rows } = interpretTable(table, { weekStart: '2026-10-26' })
  assert.equal(layout, 'grid')
  assert.deepEqual(rows.map(r => [r.name, r.date, r.start, r.end]), [
    ['Ana', '2026-10-26', '09:00', '17:00'],
    ['Ana', '2026-10-29', '07:00', '15:00'],
    ['Ben', '2026-10-27', '10:00', '14:00'],
    ['Ben', '2026-10-27', '17:00', '21:00'],
    ['Ben', '2026-10-30', '22:00', '02:00'],
  ])
  assert.equal(rows[0].sure.times, false) // 9-5 was inferred
})

test('a table that cannot be read says why', () => {
  assert.match(interpretTable([['hello', 'world']]).problems[0], /header row/)
  assert.match(interpretTable([['Name', 'Role'], ['Ana', 'x']]).problems.join(' '), /Date or Day/)
})

test('names: exact matches apply, close ones are only suggested', () => {
  const staff = [{ id: 'a', name: 'Ana Lima' }, { id: 'b', name: 'Ben Ortiz' }, { id: 'c', name: 'Ben Park' }, { id: 'd', name: 'José Ruiz' }]
  assert.deepEqual(matchStaff('ana lima', staff), { status: 'exact', staffId: 'a' })
  assert.deepEqual(matchStaff('Jose Ruiz', staff), { status: 'exact', staffId: 'd' })
  assert.deepEqual(matchStaff('Ana', staff), { status: 'suggested', staffId: 'a' })
  assert.deepEqual(matchStaff('Ben P.', staff), { status: 'suggested', staffId: 'c' })
  assert.deepEqual(matchStaff('Ben', staff), { status: 'ambiguous', staffId: null, candidates: ['b', 'c'] })
  assert.deepEqual(matchStaff('Ana Lma', staff), { status: 'suggested', staffId: 'a' })
  assert.deepEqual(matchStaff('Zed', staff), { status: 'none', staffId: null })
})

test('rows hold for review until every question is answered', () => {
  const staff = [{ id: 'a', name: 'Ana Lima' }]
  const [exact, guess, unknown] = prepareRows([
    { name: 'Ana Lima', date: '2026-10-27', start: '7:00', end: '15:00', sure: { name: true, date: true, times: true } },
    { name: 'Ana', date: '2026-10-27', start: '9', end: '5', sure: { name: true, date: true, times: false } },
    { name: 'Zed', date: null, start: null, end: null },
  ], staff)
  assert.deepEqual(exact.issues, [])
  assert.deepEqual(guess.issues, ['Check this is the right person.', 'The file was unclear here; check the details.'])
  assert.deepEqual(unknown.issues, ['Not matched to anyone on your team.', 'No date.', 'No start and end time.'])
})
