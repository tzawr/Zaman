import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { allowStaging, fs, signUp, verifyEmail, whereEq } from './helpers.js'

// HQA-08: the week a schedule is built for must be a real Monday-to-Sunday
// week, and every place that shows or stores it must agree with the real
// calendar: the week picker, the preview, the board's day/date headers, the
// stored record and the CSV export.
//
// Each case fixes the browser's clock and time zone. The audit's case is
// Tuesday 10 Nov 2026, 21:30 in California (05:30 UTC on Wednesday 11 Nov).

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const allDays = { available: true, start: '00:00', end: '23:59' }
async function readyManager() {
  const user = await verifyEmail(await signUp())
  const open = { open: true, start: '09:00', end: '17:00' }
  await fs.adminSet(`users/${user.uid}`, {
    email: user.email, onboarded: true, tier: 'free',
    roles: [{ id: 'r1', name: 'Barista' }],
    operatingHours: Object.fromEntries(DAY_KEYS.map(k => [k, open])),
    coverage: Object.fromEntries(DAY_KEYS.map(k => [k, { minPeople: 1 }])),
  })
  for (const name of ['Date Tester A', 'Date Tester B']) {
    const r = await fs.create(user.idToken, 'employees', {
      userId: user.uid, name, role: 'Barista', targetHours: 20,
      availability: Object.fromEntries(DAY_KEYS.map(k => [k, allDays])), timeOff: [],
    })
    expect(r.status).toBe(200)
  }
  return user
}

async function signInAndOpenSchedule(page, user) {
  await allowStaging(page)
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 20_000 })
  await page.goto('/schedule')
  await expect(page.locator('.gen-stat-value').first()).toHaveText('2', { timeout: 20_000 })
}

const weekInput = (page) => page.locator('input.gen-week-input')

async function generateAndCheck(page, user, expectedMonday) {
  await expect(weekInput(page)).toHaveValue(expectedMonday)
  await page.getByRole('button', { name: 'Generate schedule' }).click()
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 30_000 })

  // Board: each column's weekday name and date belong together.
  const names = await page.locator('.schedule-day-name').allTextContents()
  const dates = await page.locator('.schedule-day-date').allTextContents()
  expect(names.map(n => n.trim().slice(0, 3).toLowerCase())).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  const expectedLabels = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(`${addDays(expectedMonday, i)}T00:00:00Z`)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))
  expect(dates.map(d => d.trim())).toEqual(expectedLabels)

  // Stored record: Monday week start, and each day key carries its own date.
  const r = await fs.query(user.idToken, '', { from: [{ collectionId: 'schedules' }], where: whereEq('userId', user.uid) })
  const docs = (await r.json()).filter(x => x.document).map(x => x.document.fields)
  const latest = docs.sort((a, b) => String(b.createdAt?.timestampValue).localeCompare(String(a.createdAt?.timestampValue)))[0]
  expect(latest.weekStart.stringValue).toBe(expectedMonday)
  expect(weekdayOf(latest.weekStart.stringValue)).toBe('Monday')
  const days = latest.data.mapValue.fields.days.mapValue.fields
  DAY_KEYS.forEach((key, i) => {
    expect(days[key].mapValue.fields.date.stringValue, `${key} date`).toBe(addDays(expectedMonday, i))
  })

  // CSV: every "Weekday (date)" header names the real weekday of that date.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: /CSV/ }).first().click()
  const file = await (await download).path()
  const header = readFileSync(file, 'utf8').split('\n')[0].replace(/^\uFEFF/, '')
  const cells = header.split(',').filter(c => /\(\d{4}-\d{2}-\d{2}\)/.test(c))
  expect(cells).toHaveLength(7)
  for (const cell of cells) {
    const [, label, date] = cell.match(/^"?(\w+) \((\d{4}-\d{2}-\d{2})\)"?$/)
    expect(label, `CSV header ${cell}`).toBe(weekdayOf(date))
  }
  expect(cells[0]).toContain(`(${expectedMonday})`)
}

const cases = [
  // The audit: Tuesday evening in California, already Wednesday in UTC.
  { name: 'default week, Tuesday 21:30 in Los Angeles (the audit)', tz: 'America/Los_Angeles', now: '2026-11-11T05:30:00Z', monday: '2026-11-16' },
  { name: 'default week, Monday morning in Los Angeles', tz: 'America/Los_Angeles', now: '2026-11-09T16:00:00Z', monday: '2026-11-16' },
  { name: 'default week, Sunday night in Los Angeles', tz: 'America/Los_Angeles', now: '2026-11-16T06:30:00Z', monday: '2026-11-16' },
  { name: 'default week, Wednesday morning in Auckland (UTC+13)', tz: 'Pacific/Auckland', now: '2026-11-10T20:30:00Z', monday: '2026-11-16' },
  { name: 'default week, Kiritimati (UTC+14) just after local midnight', tz: 'Pacific/Kiritimati', now: '2026-11-15T10:30:00Z', monday: '2026-11-23' },
  { name: 'default week across a month and year boundary (Tuesday 29 Dec, London)', tz: 'Europe/London', now: '2026-12-29T23:30:00Z', monday: '2027-01-04' },
  { name: 'default week in the week US clocks fall back (Los Angeles, Sat 31 Oct)', tz: 'America/Los_Angeles', now: '2026-11-01T06:30:00Z', monday: '2026-11-02' },
  { name: 'default week when clocks spring forward (Los Angeles, Sun 7 Mar 2027 evening)', tz: 'America/Los_Angeles', now: '2027-03-08T06:30:00Z', monday: '2027-03-08' },
]

for (const c of cases) {
  test.describe(`HQA-08 ${c.name}`, () => {
    test.use({ timezoneId: c.tz })
    test('week starts on the real Monday and every view and export agrees', async ({ page }) => {
      await page.clock.install({ time: new Date(c.now) })
      const user = await readyManager()
      await signInAndOpenSchedule(page, user)
      await generateAndCheck(page, user, c.monday)
    })
  })
}

test.describe('HQA-08 choosing a week by hand', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })
  for (const [picked, monday] of [
    ['2026-11-23', '2026-11-23'], // a Monday stays as it is
    ['2026-11-24', '2026-11-23'], ['2026-11-25', '2026-11-23'], ['2026-11-26', '2026-11-23'],
    ['2026-11-27', '2026-11-23'], ['2026-11-28', '2026-11-23'], ['2026-11-29', '2026-11-23'],
    ['2026-12-31', '2026-12-28'], // a Thursday that spans into the next year
    ['2027-01-01', '2026-12-28'],
  ]) {
    test(`picking ${picked} (${weekdayOf(picked)}) builds the week of Monday ${monday}`, async ({ page }) => {
      await page.clock.install({ time: new Date('2026-11-11T05:30:00Z') })
      const user = await readyManager()
      await signInAndOpenSchedule(page, user)
      await weekInput(page).fill(picked)
      await weekInput(page).blur()
      await generateAndCheck(page, user, monday)
    })
  }
})

// Records saved before the fix are left as they are. History marks them,
// explains what is wrong, turns exports off and offers to rebuild the week.
test.describe('HQA-08 a historical schedule saved with a Tuesday week start', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })
  test('is flagged, cannot be exported, and links to the right Monday', async ({ page }) => {
    const user = await readyManager()
    const tuesday = '2026-11-17'
    const days = Object.fromEntries(DAY_KEYS.map((k, i) => [k, { date: addDays(tuesday, i), shifts: [{ employee: 'Date Tester A', role: 'Barista', start: '09:00', end: '13:00', hours: 4 }] }]))
    const id = `legacy-${Date.now()}`
    const r = await fs.adminSet(`schedules/${id}`, { userId: user.uid, weekStart: tuesday, createdAt: new Date(), data: { weekStart: tuesday, days, summary: [] } })
    expect(r.status).toBe(200)

    await allowStaging(page)
    await page.goto('/signin')
    await page.locator('input[type=email]').fill(user.email)
    await page.locator('input[type=password]').fill(user.password)
    await page.locator('form button[type=submit]').click()
    await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 20_000 })
    await page.goto('/schedules')
    await expect(page.locator('.schedule-date-badge')).toHaveText('Check dates', { timeout: 20_000 })
    await page.locator('.schedule-card').first().click()
    const alert = page.locator('.schedule-date-problem')
    await expect(alert).toContainText('Tuesday, 2026-11-17')
    await expect(alert).toContainText('Monday 2026-11-16')
    await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled()

    // The record itself is untouched.
    const stored = await (await fs.adminGet(`schedules/${id}`)).json()
    expect(stored.fields.weekStart.stringValue).toBe(tuesday)

    await alert.getByRole('button', { name: 'Build this week again' }).click()
    await expect(page).toHaveURL(/\/schedule\?week=2026-11-16/)
    await expect(weekInput(page)).toHaveValue('2026-11-16')
  })
})
