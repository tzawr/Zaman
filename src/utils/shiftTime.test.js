import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatShiftRange,
  formatShiftTime,
  isNextDay,
  normalizeShiftTimes,
  shiftLengthHours,
  toWallClock,
} from './shiftTime.js'

test('ordinary times read the way they always did', () => {
  assert.equal(formatShiftTime('08:00'), '8am')
  assert.equal(formatShiftTime('18:00'), '6pm')
  assert.equal(formatShiftTime('23:30'), '11:30pm')
  assert.equal(formatShiftTime('00:00'), '12am')
  assert.equal(formatShiftTime('12:00'), '12pm')
})

test('a shift ending at midnight shows as midnight, not noon', () => {
  // The old formatter turned 24:00 into "12pm", so every business trading until
  // midnight showed its closing shift ending at lunchtime.
  assert.equal(formatShiftTime('24:00'), '12am')
  assert.equal(isNextDay('24:00'), false)
})

test('times past midnight show the next morning with a marker', () => {
  assert.equal(formatShiftTime('26:00'), '2am +1')
  assert.equal(formatShiftTime('25:30'), '1:30am +1')
  assert.equal(formatShiftTime('28:00'), '4am +1')
  assert.equal(isNextDay('26:00'), true)
})

test('Persian keeps a 24-hour clock and the same marker', () => {
  assert.equal(formatShiftTime('20:00', 'fa'), '20:00')
  assert.equal(formatShiftTime('26:00', 'fa'), '02:00 +1')
})

test('a range marks the night once, not on both ends', () => {
  assert.equal(formatShiftRange('20:00', '26:00'), '8pm – 2am +1')
  assert.equal(formatShiftRange('24:00', '28:00'), '12am – 4am +1')
  assert.equal(formatShiftRange('09:00', '17:00'), '9am – 5pm')
})

test('wall clock strips the day offset', () => {
  assert.equal(toWallClock('26:00'), '02:00')
  assert.equal(toWallClock('24:00'), '00:00')
  assert.equal(toWallClock('09:30'), '09:30')
})

test('shift length is a plain subtraction across midnight', () => {
  assert.equal(shiftLengthHours('20:00', '26:00'), 6)
  assert.equal(shiftLengthHours('09:00', '17:00'), 8)
  assert.equal(shiftLengthHours('18:00', '24:00'), 6)
  assert.equal(shiftLengthHours('22:30', '25:00'), 2.5)
})

test('an edited shift from a 24-hour picker lands back on the timeline', () => {
  // The picker cannot offer 26:00, so an end at or before the start means the
  // next morning.
  assert.deepEqual(
    normalizeShiftTimes({ start: '20:00', end: '02:00' }),
    { start: '20:00', end: '26:00' },
  )
  assert.deepEqual(
    normalizeShiftTimes({ start: '18:00', end: '00:00' }),
    { start: '18:00', end: '24:00' },
  )
  assert.deepEqual(
    normalizeShiftTimes({ start: '09:00', end: '17:00' }),
    { start: '09:00', end: '17:00' },
  )
})

test('an overnight shift survives a round trip through the editor', () => {
  const stored = { start: '20:00', end: '26:00' }
  const shown = { start: toWallClock(stored.start), end: toWallClock(stored.end) }
  assert.deepEqual(shown, { start: '20:00', end: '02:00' })
  assert.deepEqual(normalizeShiftTimes(shown), stored)
})
