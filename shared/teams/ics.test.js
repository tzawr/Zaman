import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCalendar, googleCalendarLink, shiftEvent, utcStamp } from './ics.js'
import { messages } from './notifications.js'

const shift = {
  id: 's1', date: '2026-10-22', startLocal: '22:00', endLocal: '02:00', overnight: true, minutes: 240,
  startAt: new Date('2026-10-23T05:00:00Z'), endAt: new Date('2026-10-23T09:00:00Z'),
  positionName: 'Bar', notes: 'Close up, then lock; back door', status: 'scheduled', version: 3,
}

test('a calendar is valid iCalendar: CRLF lines, escaped text, folded at 75 octets', () => {
  const ics = buildCalendar({
    name: 'Shifts', now: new Date('2026-10-20T00:00:00Z'),
    events: [shiftEvent(shift, { bizId: 'b1', workplaceName: 'Night Owl, Bar' })],
  })
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.match(ics, /DTSTART:20261023T050000Z\r\n/)
  assert.match(ics, /SUMMARY:Night Owl\\, Bar · Bar\r\n/)
  assert.ok(ics.includes('DESCRIPTION:Close up\\, then lock\\; back door\r\n'), 'commas and semicolons are escaped')
  assert.match(ics, /UID:b1-s1@teams\.hengam\.app/)
  assert.match(ics, /STATUS:CONFIRMED/)
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line)
})

test('long lines fold without splitting characters, and a removed shift is cancelled', () => {
  const ics = buildCalendar({ name: 'x', events: [{ ...shiftEvent({ ...shift, status: 'cancelled' }, { bizId: 'b', workplaceName: 'کافه '.repeat(30) }) }] })
  const unfolded = ics.replace(/\r\n /g, '')
  assert.match(unfolded, new RegExp(`SUMMARY:${'کافه '.repeat(30)}`))
  assert.match(ics, /STATUS:CANCELLED/)
})

test('Google Calendar links carry UTC times', () => {
  const url = new URL(googleCalendarLink(shiftEvent(shift, { bizId: 'b', workplaceName: 'Bar' })))
  assert.equal(url.searchParams.get('dates'), '20261023T050000Z/20261023T090000Z')
  assert.equal(utcStamp('2026-01-02T03:04:05.678Z'), '20260102T030405Z')
})

test('notification keys are stable per event and differ across versions', () => {
  const a = messages.shiftChanged({ bizId: 'b', businessName: 'Cafe', shift })
  const b = messages.shiftChanged({ bizId: 'b', businessName: 'Cafe', shift: { ...shift, version: 4 } })
  assert.equal(a.key, messages.shiftChanged({ bizId: 'b', businessName: 'Cafe', shift }).key)
  assert.notEqual(a.key, b.key)
  assert.equal(a.title, 'Cafe: shift changed')
  assert.equal(a.body, 'Now Thu, Oct 22, 10pm – 2am (+1).')
  const removed = messages.shiftChanged({ bizId: 'b', businessName: 'Cafe', shift: { ...shift, status: 'cancelled' } })
  assert.equal(removed.link, '/calendar')
  assert.match(messages.schedulePublished({ bizId: 'b', businessName: 'Cafe', weekStart: '2026-10-19', version: 2, shiftCount: 1 }).body, /You have 1 shift\./)
})
