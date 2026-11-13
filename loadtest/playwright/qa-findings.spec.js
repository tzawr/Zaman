import { test, expect } from '@playwright/test'
import { allowStaging, fs, signUp, verifyEmail } from './helpers.js'
import { FEATURES } from '../../shared/features.js'

// The independent production QA findings other than the two scheduling bugs
// (dates.spec.js, revalidate.spec.js), each checked with real keyboard and
// pointer input.

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

async function manager({ onboarded = true } = {}) {
  const user = await verifyEmail(await signUp())
  if (onboarded) {
    await fs.adminSet(`users/${user.uid}`, {
      email: user.email, onboarded: true, tier: 'free', roles: [{ id: 'r1', name: 'Barista' }, { id: 'r2', name: 'Manager' }],
      operatingHours: Object.fromEntries(DAY_KEYS.map(k => [k, k === 'monday' ? { open: true, start: '07:00', end: '15:00' } : { open: false, start: '09:00', end: '17:00' }])),
      coverage: Object.fromEntries(DAY_KEYS.map(k => [k, { minPeople: k === 'monday' ? 2 : 0 }])),
    })
  }
  return user
}
async function addEmployee(user, name, extra = {}) {
  const r = await fs.create(user.idToken, 'employees', {
    userId: user.uid, name, role: 'Barista', targetHours: 8, timeOff: [],
    availability: Object.fromEntries(DAY_KEYS.map(k => [k, { available: true, start: '', end: '' }])), ...extra,
  })
  expect(r.status).toBe(200)
  return (await r.json()).name.split('/').pop()
}
async function seedWeek(user, issues = []) {
  const shift = (id, employee, start) => ({ id, employee, role: 'Barista', start, end: '15:00', hours: start === '07:00' ? 8 : 7 })
  const days = Object.fromEntries(DAY_KEYS.map((k, i) => [k, { date: `2026-11-${16 + i}`, shifts: k === 'monday' ? [shift('s1', 'Mira', '07:00'), shift('s2', 'Theo', '07:00')] : [] }]))
  await fs.adminSet(`schedules/qa-${Date.now()}`, { userId: user.uid, weekStart: '2026-11-16', createdAt: new Date(), data: { weekStart: '2026-11-16', days, summary: [], issues, recommendations: [], checkedRules: null } })
}
async function signInUI(page, user, url) {
  await allowStaging(page)
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 20_000 })
  if (url) await page.goto(url)
}
const activeInfo = (page) => page.evaluate(() => {
  const el = document.activeElement
  return { tag: el?.tagName, id: el?.id, text: el?.textContent?.trim().slice(0, 60), label: el?.getAttribute('aria-label'), hidden: Boolean(el?.closest('[aria-hidden="true"]')) }
})

test.describe('signed out', () => {
  test.beforeEach(async ({ page }) => { await allowStaging(page) })
  test('HQA-18 sign-in says what went wrong instead of "Something went wrong"', async ({ page }) => {
    const user = await manager()
    await page.goto('/signin')
    await page.locator('input[type=email]').fill(user.email)
    await page.locator('input[type=password]').fill('definitely-not-it')
    await page.locator('form button[type=submit]').click()
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    // A blocked Google sign-in (unauthorized domain) names the problem and the way around it.
    await page.route('**/identitytoolkit.googleapis.com/**createAuthUri**', r => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 400, message: 'UNAUTHORIZED_DOMAIN' } }) }))
    await page.evaluate(() => { window.open = () => null })
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    await expect(page.locator('.auth-error, [role=alert]').filter({ hasText: /pop-ups|Google sign-in is not available/ })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })
  test('HQA-01 Pro buttons carry the plan to signup and explain how Pro is unlocked', async ({ page }) => {
    await page.goto('/')
    await page.locator('.landing-pricing-highlighted').getByRole('button').click()
    await expect(page).toHaveURL(/\/signup\?plan=pro$/)
    await expect(page.locator('.auth-plan-note')).toContainText('access code')
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Start with Pro' }).click()
    await expect(page).toHaveURL(/\/signup\?plan=pro$/)
  })

  test('HQA-02 Tab never lands on controls hidden from assistive technology; HQA-04 first Tab is the skip link', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    expect((await activeInfo(page)).text).toBe('Skip to content')
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab')
      const a = await activeInfo(page)
      expect(a.hidden, `focus inside aria-hidden: ${JSON.stringify(a)}`).toBe(false)
    }
  })

  test('HQA-03 FAQ buttons keep the question as their name and announce their state', async ({ page }) => {
    await page.goto('/')
    const q = page.getByRole('button', { name: 'Can employees enter their own availability?', exact: true })
    await q.scrollIntoViewIfNeeded()
    await expect(q).toHaveAttribute('aria-expanded', 'false')
    await q.focus()
    await page.keyboard.press('Enter')
    await expect(q).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(`#${await q.getAttribute('aria-controls')}`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Can employees enter their own availability?', exact: true })).toHaveCount(1)
  })

  test('HQA-04 "See how it works" moves focus to the section; navigating moves focus to the new page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /See how it works/ }).click()
    expect((await activeInfo(page)).tag).toBe('H2')
    await page.locator('.site-footer').getByRole('link', { name: 'Get started' }).click()
    await expect(page).toHaveURL(/\/signup$/) // HQA-06
    await expect.poll(async () => (await activeInfo(page)).id).toBe('main-content')
  })

  test('HQA-05 phone header offers Pricing, About and Security behind a Menu button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const menu = page.getByRole('button', { name: 'Menu' })
    await expect(menu).toBeVisible()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['About', 'Pricing', 'Security']) await expect(page.locator('#site-links').getByRole('link', { name })).toBeVisible()
    // The theme button exists only while light mode is on (shared/features.js).
    const themeButton = page.getByRole('button', { name: 'Toggle theme' })
    if (await themeButton.count()) expect((await themeButton.boundingBox()).height).toBeGreaterThanOrEqual(44)
    await page.locator('#site-links').getByRole('link', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/pricing$/)
    await expect(page.locator('#site-links')).not.toHaveClass(/open/)
    await page.setViewportSize({ width: 320, height: 640 })
    await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test('HQA-07 the password minimum is shown and tied to the field before submitting', async ({ page }) => {
    await page.goto('/signup')
    const pw = page.locator('#signup-password')
    await expect(pw).toHaveAttribute('aria-describedby', 'signup-password-hint')
    await expect(page.locator('#signup-password-hint')).toHaveText('At least 6 characters.')
  })
})

test.describe('signed in', () => {
  test('HQA-13 onboarding announces a single step count', async ({ page }) => {
    const user = await manager({ onboarded: false })
    await signInUI(page, user, '/onboarding')
    await expect(page.getByText(/Step 1 of 7/)).toHaveCount(1)
    await expect(page.getByText(/Step \d+ of 2/)).toHaveCount(0)
  })

  test('HQA-14 Escape closes the account menu and returns focus; tabbing out closes it', async ({ page }) => {
    const user = await manager()
    await signInUI(page, user, '/schedules')
    const trigger = page.getByRole('button', { name: 'Open profile menu' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await expect(page.locator('#profile-dropdown')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await page.keyboard.press('Enter')
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
    await expect(page.locator('#profile-dropdown')).toHaveCount(0)
  })

  test('HQA-10/16 a saved week and its shifts work from the keyboard; the editor takes and returns focus', async ({ page }) => {
    const user = await manager()
    await addEmployee(user, 'Mira'); await addEmployee(user, 'Theo')
    await seedWeek(user)
    await signInUI(page, user, '/dashboard')
    const hero = page.locator('.dashboard-generate-hero')
    await hero.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/schedule$/)

    await page.goto('/schedules')
    const open = page.getByRole('button', { name: /^Open schedule: / })
    await open.focus()
    await page.keyboard.press('Enter')
    const chip = page.getByRole('button', { name: /^Edit shift: Theo, / })
    await chip.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Edit shift' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible()
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(chip).toBeFocused()
    // Add shift: focus also goes in, and Tab stays inside.
    await page.getByRole('button', { name: /^Add shift Wed/ }).focus()
    await page.keyboard.press('Enter')
    for (let i = 0; i < 15; i++) await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
  })

  test('HQA-11 availability says Save is needed, and leaving with unsaved edits asks first', async ({ page }) => {
    const user = await manager()
    const id = await addEmployee(user, 'Theo')
    await signInUI(page, user, `/employees/${id}/availability`)
    await expect(page.getByText('Press Save under each section to keep your changes.', { exact: false })).toBeVisible({ timeout: 20_000 })
    await page.locator('.day-toggle').first().click()
    await expect(page.getByText('Unsaved changes. Press Save to keep them.').first()).toBeVisible()
    let asked = 0
    page.on('dialog', d => { asked++; d.dismiss() })
    await page.getByRole('button', { name: /Back/ }).first().click()
    expect(asked).toBe(1)
    await expect(page).toHaveURL(new RegExp(`/employees/${id}/availability`))
    // Save, then leaving needs no confirmation.
    await page.locator('.avail-save-btn').first().click()
    await expect(page.locator('.avail-save-btn').first()).toContainText('Saved')
    await page.getByRole('button', { name: /Back/ }).first().click()
    await expect(page).toHaveURL(/\/employees$/)
    expect(asked).toBe(1)
  })

  test('HQA-17 an existing employee\'s name, role and target can be edited and persist', async ({ page }) => {
    const user = await manager()
    const id = await addEmployee(user, 'Theo')
    await signInUI(page, user, '/employees')
    await page.getByRole('button', { name: 'Edit details for Theo' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Theo' })
    await dialog.getByLabel('Name').fill('Theo Park')
    await dialog.getByLabel('Role').selectOption('Manager')
    await dialog.getByLabel('Target hrs/week').fill('24')
    await expect(dialog.getByRole('note')).toContainText('keep the name')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.team-card-name')).toHaveText('Theo Park', { timeout: 20_000 })
    const f = (await (await fs.adminGet(`employees/${id}`)).json()).fields
    expect([f.name.stringValue, f.role.stringValue, Number(f.targetHours.integerValue ?? f.targetHours.doubleValue)]).toEqual(['Theo Park', 'Manager', 24])
  })

  test('HQA-15 Persian review items are in Persian and the panel is right-to-left', async ({ page }) => {
    test.skip(!FEATURES.persian, 'Persian is switched off (shared/features.js)')
    const user = await manager()
    await addEmployee(user, 'Mira'); await addEmployee(user, 'Theo')
    await seedWeek(user, ['Monday: needs 2 staff from 07:00–08:00 — only 1 on shift', 'Theo: only 7h scheduled but target is 8h — no unused available days remain'])
    await page.addInitScript(() => localStorage.setItem('hengam-language', 'fa'))
    await signInUI(page, user, '/schedules')
    await page.locator('.schedule-card').first().click()
    const panel = page.locator('.schedule-issues')
    await expect(panel).toHaveAttribute('dir', 'rtl')
    await expect(panel).toContainText('نیاز است')
    await expect(panel).toContainText('هدف')
    await expect(panel).not.toContainText('scheduled but target')
  })
})
