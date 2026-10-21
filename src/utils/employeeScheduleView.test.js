import { test } from 'node:test'
import assert from 'node:assert/strict'
import { employeeScheduleView, ownShiftsOnly } from './employeeScheduleView.js'

const schedule = {
  id: 's1',
  weekStart: '2026-10-19',
  content: '{"secret":true}',
  data: {
    days: {
      monday: {
        date: '2026-10-19',
        shifts: [
          { employee: 'Ana', start: '08:00', end: '16:00', role: 'Barista', hours: 8, note: 'x' },
          { employee: 'Ben', start: '10:00', end: '18:00', role: 'Barista', hours: 8 },
        ],
      },
      tuesday: { date: '2026-10-20', shifts: [{ employee: 'Ben', start: '20:00', end: '26:00', hours: 6 }] },
    },
    summary: { Ben: 14, Ana: 8 },
  },
}

test('an employee without full view sees only their own shifts', () => {
  const view = employeeScheduleView(schedule, { employeeName: 'Ana', fullView: false })
  assert.deepEqual(view.data.days.monday.shifts, [
    { employee: 'Ana', start: '08:00', end: '16:00', role: 'Barista', hours: 8 },
  ])
  assert.deepEqual(view.data.days.tuesday, { date: '2026-10-20', shifts: [] })
  assert.equal(view.data.summary, undefined)
  assert.equal(JSON.stringify(view).includes('Ben'), false)
})

test('raw content never leaves, even with full view', () => {
  const full = employeeScheduleView(schedule, { employeeName: 'Ana', fullView: true })
  assert.equal(full.content, undefined)
  assert.equal(full.data, schedule.data)
})

test('an unknown name matches nothing rather than everything', () => {
  const view = ownShiftsOnly(schedule.data, undefined)
  assert.equal(view.days.monday.shifts.length, 0)
})
