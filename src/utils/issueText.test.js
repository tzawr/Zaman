import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIssue } from './issueText.js'

test('every review item the validator writes is recognised for translation', () => {
  const cases = {
    'Monday: needs 2 staff from 07:00–08:00 — only 1 on shift': ['staffGap', { day: 'monday', count: '2', from: '07:00', to: '08:00', on: '1' }],
    'Tuesday: needs at least 2 people on shift — only 1 scheduled': ['dayMinimum', { day: 'tuesday', count: '2', on: '1' }],
    'Friday: Ana Lima is scheduled twice on the same day': ['twice', { day: 'friday', name: 'Ana Lima' }],
    'Monday: Theo is not available': ['notAvailable', { day: 'monday', name: 'Theo' }],
    'Monday: Theo shift 07:00–15:00 is outside availability 09:00–17:00': ['outsideAvailability', { day: 'monday', name: 'Theo', start: '07:00', end: '15:00', avStart: '09:00', avEnd: '17:00' }],
    'Monday: Theo has approved time off on 2026-11-23': ['timeOff', { day: 'monday', name: 'Theo', date: '2026-11-23' }],
    'Monday: Theo shift is 3h — minimum is 4h': ['shiftShort', { day: 'monday', name: 'Theo', hours: '3' }],
    'Monday: Theo shift is 9h — maximum is 8.5h': ['shiftLong', { day: 'monday', name: 'Theo', hours: '9' }],
    'Monday: "Zed" is not a known employee': ['unknownEmployee', { day: 'monday', name: 'Zed' }],
    'Theo: scheduled 10h but target is 8h — 2h over': ['targetOver', { name: 'Theo', hours: '10', target: '8', diff: '2' }],
    'Theo: only 0h scheduled but target is 8h — add shifts on: Monday, Wednesday': ['targetUnder', { name: 'Theo', hours: '0', target: '8', days: ['monday', 'wednesday'] }],
    'Theo: only 0h scheduled but target is 8h — no unused available days remain': ['targetUnderNone', { name: 'Theo', hours: '0', target: '8' }],
  }
  for (const [text, [kind, params]] of Object.entries(cases)) {
    assert.deepEqual(parseIssue(text), { kind, params }, text)
  }
  assert.equal(parseIssue('Monday: needs 1 opener(s) by 07:00 — only 0 found'), null)
})
