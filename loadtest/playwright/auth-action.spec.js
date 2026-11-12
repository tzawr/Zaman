import { test, expect } from '@playwright/test'
import { STAGING, fs, signUp, verifyEmail } from './helpers.js'

// HENGAM's email action page (/auth/action): reset, verification, expired and
// broken links, in English and Persian, on a phone. Local emulators only: the
// one-time codes come from the Auth emulator's record of sent emails.
test.skip(STAGING, 'needs the Auth emulator')

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
const codes = async (email) => (await (await fetch(`http://${AUTH}/emulator/v1/projects/demo-hengam/oobCodes`)).json()).oobCodes.filter(c => c.email === email)

test('reset from "Forgot password", in Persian on a phone: new password works, old one does not', async ({ page }) => {
  const user = await signUp()
  await page.setViewportSize({ width: 360, height: 780 })
  await page.addInitScript(() => { try { localStorage.setItem('hengam-language', 'fa') } catch { /* empty */ } })
  await page.goto('/forgot-password')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('form button[type=submit]').click()
  await expect.poll(async () => (await codes(user.email)).filter(c => c.requestType === 'PASSWORD_RESET').length, { timeout: 15_000 }).toBe(1)
  const { oobCode } = (await codes(user.email)).find(c => c.requestType === 'PASSWORD_RESET')

  await page.goto(`/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}&lang=fa`)
  await expect(page.getByRole('heading', { name: 'رمز عبور جدید انتخاب کنید' })).toBeFocused({ timeout: 15_000 })
  await expect(page.locator('main')).toHaveAttribute('dir', 'rtl')
  await page.getByLabel('رمز عبور جدید').fill('a-new-pass-77')
  await page.getByRole('button', { name: 'ذخیره رمز عبور' }).click()
  await expect(page.getByRole('heading', { name: 'رمز عبور شما تغییر کرد' })).toBeVisible()
  const box = await page.locator('.auth-card').boundingBox()
  expect(box.x + box.width).toBeLessThanOrEqual(360)

  const signIn = (password) => fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password, returnSecureToken: true }) })
  expect((await signIn('a-new-pass-77')).status).toBe(200)
  expect((await signIn(user.password)).status).not.toBe(200)

  // The same link again: used up, with a way to get a new one.
  await page.goto(`/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}&lang=en`)
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'Get a new reset link' })).toHaveAttribute('href', '/forgot-password')
})

test('verification link verifies the account and continues into HENGAM', async ({ page }) => {
  const user = await signUp()
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await expect(page).toHaveURL(/\/verify-email/, { timeout: 20_000 })
  await page.getByRole('button', { name: /Resend verification email/ }).click()
  await expect.poll(async () => (await codes(user.email)).filter(c => c.requestType === 'VERIFY_EMAIL').length, { timeout: 15_000 }).toBeGreaterThan(0)
  const { oobCode } = (await codes(user.email)).filter(c => c.requestType === 'VERIFY_EMAIL').pop()
  await page.goto(`/auth/action?mode=verifyEmail&oobCode=${encodeURIComponent(oobCode)}&lang=en&continue=/dashboard`)
  await expect(page.getByRole('heading', { name: 'Your email is verified' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'Continue to HENGAM' })).toHaveAttribute('href', '/dashboard')
})

test('broken and unknown links explain themselves, never crash', async ({ page }) => {
  await page.goto('/auth/action?mode=verifyEmail&oobCode=not-a-real-code')
  await expect(page).toHaveTitle(/Your account/)
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('heading', { name: /expired|could not finish/ })).toBeVisible({ timeout: 15_000 })
  await page.goto('/auth/action?mode=somethingElse&oobCode=x')
  await expect(page.getByText('This link is not complete')).toBeVisible()
  await page.goto('/auth/action')
  await expect(page.getByText('This link is not complete')).toBeVisible()
})

test('email change from Profile: link to the new address changes the sign-in email; the old one stops working', async ({ page }) => {
  const user = await verifyEmail(await signUp())
  await fs.adminSet(`users/${user.uid}`, { email: user.email, onboarded: true, tier: 'free' })
  const newEmail = `moved-${Date.now()}@example.test`
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await expect(page).toHaveURL(/\/(dashboard|onboarding|welcome)/, { timeout: 20_000 })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Change', exact: true }).first().click()
  await page.getByLabel('New email address').fill(newEmail)
  await page.getByLabel('Current password (to confirm)').fill(user.password)
  await page.getByRole('button', { name: 'Send verification' }).click()
  await expect.poll(async () => (await codes(user.email)).filter(c => c.requestType === 'VERIFY_AND_CHANGE_EMAIL').length, { timeout: 15_000 }).toBe(1)
  const { oobCode } = (await codes(user.email)).find(c => c.requestType === 'VERIFY_AND_CHANGE_EMAIL')

  await page.goto(`/auth/action?mode=verifyAndChangeEmail&oobCode=${encodeURIComponent(oobCode)}&lang=en&continue=/signin`)
  await expect(page.getByRole('heading', { name: 'Your sign-in email is updated' })).toBeVisible({ timeout: 15_000 })
  const signIn = (email) => fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: user.password, returnSecureToken: true }) })
  expect((await signIn(newEmail)).status).toBe(200)
  expect((await signIn(user.email)).status).not.toBe(200)
})

/** Completes the Auth emulator's Google sign-in window as `email`. */
async function emulatorGoogle(popup, email) {
  await popup.waitForLoadState()
  const existing = popup.getByText(email)
  if (await existing.count()) { await existing.first().click(); return }
  await popup.getByRole('button', { name: /add new account/i }).click()
  await popup.locator('#email-input').fill(email)
  await popup.getByRole('button', { name: /sign in with google/i }).click()
}

test('email change, Google-only account: confirms with Google first, then the link goes to the new address', async ({ page }) => {
  const email = `google-ec-${Date.now()}@example.test`
  await page.goto('/signin')
  const [first] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Continue with Google' }).click()])
  await emulatorGoogle(first, email)
  await expect(page).toHaveURL(/\/(dashboard|onboarding|welcome)/, { timeout: 20_000 })
  const users = (await (await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-hengam/accounts:lookup`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: [email] }) })).json()).users
  expect(users[0].providerUserInfo.map(p => p.providerId)).toEqual(['google.com'])
  await fs.adminSet(`users/${users[0].localId}`, { email, onboarded: true, tier: 'free' })

  await page.goto('/profile')
  await page.getByRole('button', { name: 'Change', exact: true }).first().click()
  await expect(page.getByLabel('Current password (to confirm)')).toHaveCount(0)
  const newEmail = `google-moved-${Date.now()}@example.test`
  await page.getByLabel('New email address').fill(newEmail)
  const [again] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Send verification' }).click()])
  await emulatorGoogle(again, email)
  await expect.poll(async () => (await codes(email)).filter(c => c.requestType === 'VERIFY_AND_CHANGE_EMAIL').length, { timeout: 15_000 }).toBe(1)
  await expect(page.getByText(`${newEmail}`)).toBeVisible()
})

test('email change, password account: the current password is required (no request without it)', async ({ page }) => {
  const user = await verifyEmail(await signUp())
  await fs.adminSet(`users/${user.uid}`, { email: user.email, onboarded: true, tier: 'free' })
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await expect(page).toHaveURL(/\/(dashboard|onboarding|welcome)/, { timeout: 20_000 })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Change', exact: true }).first().click()
  await page.getByLabel('New email address').fill(`nopass-${Date.now()}@example.test`)
  await page.getByRole('button', { name: 'Send verification' }).click()
  await expect(page.getByText('Enter your current password.')).toBeVisible()
  await page.getByLabel('Current password (to confirm)').fill('not-my-password')
  await page.getByRole('button', { name: 'Send verification' }).click()
  await expect(page.locator('.auth-error')).toBeVisible()
  await page.waitForTimeout(1000)
  expect((await codes(user.email)).filter(c => c.requestType === 'VERIFY_AND_CHANGE_EMAIL').length).toBe(0)
})
