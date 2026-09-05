import assert from 'node:assert/strict'
import test from 'node:test'

// The CSV path writes through the browser download helper, so stub just enough
// of the DOM to capture what would have been written to the file.
let captured = null
globalThis.Blob = class { constructor(parts) { this.parts = parts } }
globalThis.URL = {
  createObjectURL: (blob) => { captured = blob.parts.join(''); return 'blob:test' },
  revokeObjectURL() {},
}
globalThis.document = {
  createElement: () => ({ click() {}, set href(_v) {}, set download(_v) {} }),
  body: { appendChild() {}, removeChild() {} },
}

const { exportToCSV } = await import('./exportSchedule.js')

const emptyWeek = () => Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map((day, i) => [day, { date: `2026-05-0${4 + i}`, shifts: [] }]),
)

function csvFor(shifts, summary = [], extra = {}) {
  const days = emptyWeek()
  days.monday.shifts = shifts
  exportToCSV({ weekStart: '2026-05-04', days, summary, ...extra }, '2026-05-04')
  return captured
}

test('a name that looks like a formula cannot execute in a spreadsheet', () => {
  const csv = csvFor([
    { employee: '=HYPERLINK("http://evil.example","payroll")', role: 'Barista', start: '08:00', end: '16:00', hours: 8 },
    { employee: '+1+1', role: 'Cashier', start: '10:00', end: '14:00', hours: 4 },
  ])

  for (const line of csv.split('\n').slice(1)) {
    if (!line) continue
    const first = line.startsWith('"') ? line.slice(1) : line
    assert.ok(!/^[=+@]/.test(first), `cell would run as a formula: ${line}`)
  }
})

test('numeric columns stay numeric, including negative differences', () => {
  const csv = csvFor(
    [{ employee: 'Ava', role: 'Barista', start: '08:00', end: '16:00', hours: 8 }],
    [{ employee: 'Ava', role: 'Barista', scheduledHours: 8, targetHours: 20, difference: -12 }],
  )
  const row = csv.split('\n').find(line => line.startsWith('Ava'))
  assert.ok(row.endsWith(',8,20,-12'), `expected plain numbers, got: ${row}`)
})

test('commas and quotes in names are escaped, and non-Latin names survive', () => {
  const csv = csvFor([
    { employee: 'Smith, John "JJ"', role: 'Manager', start: '09:00', end: '17:00', hours: 8 },
    { employee: 'محمد', role: 'باریستا', start: '12:00', end: '20:00', hours: 8 },
  ])
  assert.ok(csv.includes('"Smith, John ""JJ"""'))
  assert.ok(csv.includes('محمد'))
})

test('exporting nothing does not throw', () => {
  assert.doesNotThrow(() => exportToCSV(null, '2026-05-04'))
  assert.doesNotThrow(() => exportToCSV({ days: null }, '2026-05-04'))
})
