import { test, expect } from '@playwright/test'
import { BYPASS, STAGING, fs, signUp, verifyEmail } from './helpers.js'

// Browser-side error reporting for sign-in: an unexpected failure (Auth
// unavailable) reaches monitoring as auth.signin, with the error code only;
// a person's own mistake (wrong password) is not reported.

async function authEvents() {
  const r = await fs.adminQuery({ from: [{ collectionId: 'errorEvents' }] })
  return (await r.json()).filter(x => x.document).map(x => x.document.fields)
    .filter(f => String(f.where?.stringValue || '').startsWith('auth.'))
}
const total = (events) => events.reduce((n, e) => n + Number(e.count?.integerValue || 1), 0)

test.describe.serial('sign-in error reporting', () => {
  let user
  test.beforeAll(async () => { user = await verifyEmail(await signUp()) })

  async function open(page) {
    if (STAGING) await page.goto(`/?x-vercel-protection-bypass=${BYPASS['x-vercel-protection-bypass']}&x-vercel-set-bypass-cookie=true`)
    await page.goto('/signin')
  }
  async function attempt(page, password) {
    await page.locator('input[type=email]').fill(user.email)
    await page.locator('input[type=password]').fill(password)
    await page.locator('form button[type=submit]').click()
  }

  test('a wrong password is shown to the person and not reported', async ({ page }) => {
    const before = total(await authEvents())
    await open(page)
    await attempt(page, 'definitely-wrong-password')
    await expect(page.locator('.auth-error, [role=alert], .error, .form-error').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    expect(total(await authEvents())).toBe(before)
  })

  test('an Auth outage during sign-in is reported as auth.signin, with no email', async ({ page }) => {
    const before = total(await authEvents())
    await open(page)
    // The sign-in call fails as if the Auth service were down.
    await page.route('**/identitytoolkit.googleapis.com/**', route => route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 500, message: 'INTERNAL_ERROR', errors: [{ message: 'INTERNAL_ERROR', reason: 'backendError' }] } }),
    }))
    await attempt(page, user.password)
    await expect.poll(async () => total(await authEvents()), { timeout: 15_000 }).toBeGreaterThan(before)
    const events = await authEvents()
    expect(events.map(e => e.where.stringValue)).toContain('auth.signin')
    expect(JSON.stringify(events)).not.toContain(user.email)
  })
})
