import { test, expect } from '@playwright/test'
import { allowStaging, fs, signUp, verifyEmail } from './helpers.js'

// HQA-09: a manual edit that leaves the week short must show and save that
// as a review item; history must never call it Ready. Also: two tabs editing
// the same saved week must not silently overwrite each other.

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MONDAY = '2026-11-16'
const dateOf = (i) => { const d = new Date(`${MONDAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) }

async function seededWeek() {
  const user = await verifyEmail(await signUp())
  await fs.adminSet(`users/${user.uid}`, {
    email: user.email, onboarded: true, tier: 'free', roles: [{ id: 'r1', name: 'Barista' }],
    operatingHours: Object.fromEntries(DAY_KEYS.map(k => [k, k === 'monday' ? { open: true, start: '07:00', end: '15:00' } : { open: false, start: '09:00', end: '17:00' }])),
    coverage: Object.fromEntries(DAY_KEYS.map(k => [k, { minPeople: k === 'monday' ? 2 : 0 }])),
  })
  for (const name of ['Mira', 'Theo']) {
    const r = await fs.create(user.idToken, 'employees', {
      userId: user.uid, name, role: 'Barista', targetHours: 8, timeOff: [],
      availability: Object.fromEntries(DAY_KEYS.map(k => [k, { available: true, start: '', end: '' }])),
    })
    expect(r.status).toBe(200)
  }
  const shift = (id, employee) => ({ id, employee, role: 'Barista', start: '07:00', end: '15:00', hours: 8 })
  const days = Object.fromEntries(DAY_KEYS.map((k, i) => [k, { date: dateOf(i), shifts: k === 'monday' ? [shift('s1', 'Mira'), shift('s2', 'Theo')] : [] }]))
  const id = `hqa09-${Date.now()}`
  // As the generator saves a clean week: no review items.
  const r = await fs.adminSet(`schedules/${id}`, { userId: user.uid, weekStart: MONDAY, createdAt: new Date(), data: { weekStart: MONDAY, days, summary: [], issues: [], recommendations: [], checkedRules: null } })
  expect(r.status).toBe(200)
  return { user, id }
}

async function openHistory(page, user) {
  await allowStaging(page)
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 20_000 })
  await page.goto('/schedules')
  await page.locator('.schedule-card').first().click()
  await expect(page.locator('.schedule-shift-name', { hasText: 'Theo' })).toBeVisible({ timeout: 20_000 })
}

async function editStart(page, employee, start) {
  await page.locator('.schedule-shift', { has: page.locator('.schedule-shift-name', { hasText: employee }) }).first().click()
  await page.locator('#scheduletable-start').fill(start)
  await page.locator('.shift-modal').getByRole('button', { name: 'Save' }).click()
}

const stored = async (id) => (await (await fs.adminGet(`schedules/${id}`)).json()).fields
const storedIssues = (f) => (f.data.mapValue.fields.issues?.arrayValue?.values || []).map(v => v.stringValue)

test('HQA-09 moving a start to 08:00 shows and saves the 07:00–08:00 shortfall, and history is not Ready', async ({ page }) => {
  const { user, id } = await seededWeek()
  await openHistory(page, user)
  await expect(page.locator('.schedule-card').first()).toContainText('Ready')

  await editStart(page, 'Theo', '08:00')
  await expect(page.locator('.schedule-issues')).toContainText(/07:00\W*–\W*08:00/, { timeout: 10_000 })

  // What was saved: Theo's new start and the matching review item, together.
  await expect.poll(async () => storedIssues(await stored(id)).join('\n'), { timeout: 10_000 }).toContain('07:00–08:00')
  const theo = (await stored(id)).data.mapValue.fields.days.mapValue.fields.monday.mapValue.fields.shifts.arrayValue.values
    .map(v => v.mapValue.fields).find(s => s.employee.stringValue === 'Theo')
  expect(theo.start.stringValue).toBe('08:00')

  // After a reload, history agrees.
  await page.reload()
  await expect(page.locator('.schedule-card').first()).not.toContainText('Ready', { timeout: 20_000 })
  await expect(page.locator('.schedule-card .needs-review').first()).toBeVisible()

  // Putting it back clears the item.
  await page.locator('.schedule-card').first().click()
  await editStart(page, 'Theo', '07:00')
  await expect.poll(async () => storedIssues(await stored(id)).length, { timeout: 10_000 }).toBe(0)
  await expect(page.locator('.schedule-card').first()).toContainText('Ready')
})

test('HQA-09 two tabs editing the same week: the stale edit is refused, nothing is overwritten', async ({ browser }) => {
  const { user, id } = await seededWeek()
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await openHistory(a, user)
  await openHistory(b, user)

  await editStart(a, 'Theo', '08:00')
  await expect.poll(async () => storedIssues(await stored(id)).join('\n'), { timeout: 10_000 }).toContain('07:00–08:00')

  // Tab B still shows the old week and edits Mira.
  await editStart(b, 'Mira', '09:00')
  await expect(b.getByText(/changed in another tab/)).toBeVisible({ timeout: 10_000 })

  const f = await stored(id)
  const shifts = f.data.mapValue.fields.days.mapValue.fields.monday.mapValue.fields.shifts.arrayValue.values.map(v => v.mapValue.fields)
  expect(shifts.find(s => s.employee.stringValue === 'Theo').start.stringValue).toBe('08:00')
  expect(shifts.find(s => s.employee.stringValue === 'Mira').start.stringValue).toBe('07:00')
  // The saved review items describe the saved shifts.
  expect(storedIssues(f).join('\n')).toContain('needs 2 staff from 07:00–08:00')
})
