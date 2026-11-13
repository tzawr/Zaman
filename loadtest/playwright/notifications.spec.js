import { test, expect } from '@playwright/test'
import { allowStaging, fs, signUp, verifyEmail } from './helpers.js'
import { FEATURES } from '../../shared/features.js'

// The notification center and preferences, with real keyboard and pointer
// input, against the app and its rules.

async function manager() {
  const user = await verifyEmail(await signUp())
  await fs.adminSet(`users/${user.uid}`, { email: user.email, onboarded: true, tier: 'free', roles: [{ id: 'r1', name: 'Barista' }] })
  return user
}
async function notify(user, id, data) {
  const r = await fs.adminSet(`users/${user.uid}/notifications/${id}`, { readAt: null, createdAt: new Date(), ...data })
  expect(r.status).toBe(200)
}
async function signIn(page, user, url = '/dashboard') {
  await allowStaging(page)
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 20_000 })
  if (url) await page.goto(url)
}
const bell = (page) => page.locator('.notif-bell-button')

test('the bell counts unread, opens items in place, and marks all read', async ({ page }) => {
  const user = await manager()
  await notify(user, 'web_inv_1', { type: 'invite_accepted', app: 'web', link: '/employees', title: 'Ana joined your team', body: 'They can now see their shifts.', facts: { who: 'Ana' } })
  await notify(user, 'pub_1', { type: 'schedule_published', app: 'teams', link: '/calendar', title: 'Blue Door: schedule is out', body: 'Nov 16 – Nov 22.', facts: { biz: 'Blue Door', weekStart: '2026-11-16', count: 2 } })
  await signIn(page, user)
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 2 unread', { timeout: 20_000 })
  await expect(page.locator('.notif-badge')).toHaveText('2')

  // Keyboard: open with Enter, Escape closes and returns focus.
  await bell(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#notif-panel')).toBeVisible()
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('#notif-panel')).toHaveCount(0)
  await expect(bell(page)).toBeFocused()

  await bell(page).click()
  await page.getByRole('button', { name: /Ana joined your team/ }).click()
  await expect(page).toHaveURL(/\/employees$/)
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 1 unread', { timeout: 10_000 })
  const read = await (await fs.adminGet(`users/${user.uid}/notifications/web_inv_1`)).json()
  expect(read.fields.readAt.timestampValue).toBeTruthy()

  await bell(page).click()
  await page.getByRole('button', { name: 'Mark all read' }).click()
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications', { timeout: 10_000 })
  await expect(page.locator('.notif-badge')).toHaveCount(0)
})

test('Persian: items read in Persian, right to left; empty state; phone width', async ({ page }) => {
  test.skip(!FEATURES.persian, 'Persian is switched off (shared/features.js)')
  const user = await manager()
  await page.setViewportSize({ width: 320, height: 760 })
  await page.addInitScript(() => { try { localStorage.setItem('hengam-language', 'fa') } catch { /* empty */ } })
  await signIn(page, user)
  await bell(page).click()
  await expect(page.locator('.notif-empty')).toBeVisible()
  await page.keyboard.press('Escape')
  await notify(user, 'web_avail_1', { type: 'availability_changed', app: 'web', link: '/employees', title: 'Ana updated their availability', body: 'x', facts: { who: 'Ana' } })
  await expect(page.locator('.notif-badge')).toHaveText('1', { timeout: 20_000 })
  await bell(page).click()
  const panel = page.locator('#notif-panel')
  await expect(panel).toHaveAttribute('dir', 'rtl')
  await expect(panel).toContainText('زمان‌های در دسترس بودنش را به‌روز کرد')
  const box = await panel.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  // The header still fits with the bell in it.
  const navRight = await page.evaluate(() => document.querySelector('nav.navbar').getBoundingClientRect().right)
  expect(navRight).toBeLessThanOrEqual(321)
})

test('nobody sees another account’s notifications', async ({ page }) => {
  const owner = await manager()
  const other = await manager()
  await notify(owner, 'web_inv_x', { type: 'invite_accepted', app: 'web', link: '/employees', title: 'Private: Ana joined', body: 'x', facts: { who: 'Ana' } })
  await signIn(page, other)
  await bell(page).click()
  await expect(page.locator('.notif-empty')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Private: Ana joined')).toHaveCount(0)
})

test('preferences: switches save per channel; security emails are explained as always on', async ({ page }) => {
  const user = await manager()
  await signIn(page, user, '/profile#notifications')
  const section = page.locator('#notifications')
  await expect(section).toBeVisible({ timeout: 20_000 })
  await expect(section).toContainText('always sent')
  const scheduleEmail = section.getByRole('switch', { name: 'Schedules: Email' })
  await expect(scheduleEmail).toBeChecked()
  await scheduleEmail.press('Space')
  await expect(scheduleEmail).not.toBeChecked()
  await section.getByRole('switch', { name: 'Product news: Email' }).press('Space')
  // The email-language picker exists only while Persian is on (shared/features.js).
  if (FEATURES.persian) await section.getByLabel('Language for emails').selectOption('fa')
  else await expect(section.getByLabel('Language for emails')).toHaveCount(0)
  await expect.poll(async () => {
    const d = await (await fs.adminGet(`users/${user.uid}`)).json()
    const p = d.fields.notificationPrefs?.mapValue?.fields
    return p ? [p.email.mapValue.fields.schedule.booleanValue, p.email.mapValue.fields.product.booleanValue, FEATURES.persian ? p.language.stringValue : 'fa'].join(',') : ''
  }, { timeout: 10_000 }).toBe('false,true,fa')
  await page.reload()
  await expect(page.locator('#notifications').getByRole('switch', { name: 'Schedules: Email' })).not.toBeChecked({ timeout: 20_000 })
})
