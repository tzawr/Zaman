import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'

// HQA-08 at the scheduler: the dates a generated week carries must be the
// real calendar dates of Monday..Sunday, whatever time zone the browser (here
// the process) is in, and whatever weekday the caller passed. The UTC+12..14
// failure only appears when the process itself runs in that zone, so each
// case runs in a child process with TZ set.

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const script = `
  import { runScheduler } from ${JSON.stringify(new URL('./scheduler.js', import.meta.url).href)}
  const DAYS = ${JSON.stringify(DAYS)}
  const every = (v) => Object.fromEntries(DAYS.map(d => [d, { ...v }]))
  const person = (name) => ({ name, role: 'Barista', targetHours: 20, availability: every({ available: true, start: '', end: '' }), timeOff: [] })
  const r = runScheduler([person('Ava'), person('Bo')], { operatingHours: every({ open: true, start: '09:00', end: '17:00' }) }, process.argv[1], {})
  console.log(JSON.stringify({ weekStart: r.weekStart, dates: DAYS.map(d => r.days[d].date) }))
`
function run(tz, weekStart) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script, weekStart], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })
  return JSON.parse(out.trim().split('\n').pop())
}
const week = (monday) => DAYS.map((_, i) => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) })

for (const tz of ['Pacific/Kiritimati', 'Pacific/Auckland', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles', 'Pacific/Honolulu']) {
  test(`a Monday week carries its real dates in ${tz}`, () => {
    assert.deepEqual(run(tz, '2026-11-16'), { weekStart: '2026-11-16', dates: week('2026-11-16') })
  })
}

test('a non-Monday week start becomes the week that contains it (never a mislabelled Monday)', () => {
  assert.deepEqual(run('America/Los_Angeles', '2026-11-17'), { weekStart: '2026-11-16', dates: week('2026-11-16') })
  assert.deepEqual(run('Pacific/Auckland', '2027-01-01'), { weekStart: '2026-12-28', dates: week('2026-12-28') })
})

test('weeks across DST changes keep consecutive dates', () => {
  assert.deepEqual(run('America/Los_Angeles', '2026-11-02').dates, week('2026-11-02'))
  assert.deepEqual(run('Europe/London', '2027-03-29').dates, week('2027-03-29'))
})
