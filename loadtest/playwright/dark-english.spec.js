import { test, expect } from '@playwright/test'
import { allowStaging, fs, signUp, verifyEmail } from './helpers.js'

// English-only + dark-only (shared/features.js). People who saved Persian or
// light mode before get English and dark, their saved choices are left alone,
// no switcher is shown, and no page paints large light surfaces or unreadable
// text. Runs signed out and signed in, on a desktop and a phone.

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const PUBLIC = ['/', '/pricing', '/about', '/security', '/privacy', '/terms', '/signin', '/signup', '/forgot-password', '/auth/action?mode=verifyEmail&oobCode=x', '/no-such-page']
const SIGNED_IN = ['/dashboard', '/employees', '/schedule', '/schedules', '/settings', '/profile', '/my-schedule', '/my-availability']
const VIEWPORTS = { desktop: { width: 1366, height: 900 }, phone: { width: 375, height: 812 } }

/** In the page: large light surfaces, low-contrast text, Persian/RTL, switchers. */
function audit() {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(',').map(Number); return { r, g, b, a } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1 && !el.closest('[aria-hidden="true"],.sr-only,.skip-link') }
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c } return parse(getComputedStyle(document.body).backgroundColor) }
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`
  const light = []; const lowContrast = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || ['svg', 'path', 'img', 'IMG', 'circle', 'rect', 'line', 'polyline', 'g'].includes(el.tagName.toLowerCase())) continue
    const c = parse(getComputedStyle(el).backgroundColor)
    const r = el.getBoundingClientRect()
    // Toggle knobs, dots and small badges may be light; panels and cards may not.
    if (c && c.a > 0.5 && lum(c) > 0.6 && r.width * r.height > 2500) light.push(`${name(el)} ${getComputedStyle(el).backgroundColor} ${Math.round(r.width)}x${Math.round(r.height)}`)
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
    if (text.length > 1) {
      const fg = parse(getComputedStyle(el).color); const bg = bgOf(el)
      if (fg && bg && fg.a > 0.5) {
        const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a)
        const ratio = (hi + 0.05) / (lo + 0.05)
        const size = parseFloat(getComputedStyle(el).fontSize); const bold = Number(getComputedStyle(el).fontWeight) >= 700
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
        if (ratio < need && !el.closest('button[disabled],[aria-disabled="true"],input[disabled]') && !el.matches('::placeholder')) lowContrast.push(`${name(el)} "${text.slice(0, 30)}" ${ratio.toFixed(2)}<${need}`)
      }
    }
  }
  return {
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    appClass: document.querySelector('.app')?.className || '',
    lang: document.documentElement.lang,
    rtl: document.querySelectorAll('[dir="rtl"]').length,
    persianText: (document.body.innerText.match(/[؀-ۿ]+/g) || []).slice(0, 3),
    themeToggle: document.querySelectorAll('[aria-label="Toggle theme"]').length,
    languageToggle: document.querySelectorAll('.navbar-language-button,[aria-label="Switch language"]').length,
    emailLanguageSelect: document.querySelectorAll('.notif-prefs-lang').length,
    savedLanguage: localStorage.getItem('hengam-language'),
    savedTheme: localStorage.getItem('hengam-theme'),
    light: [...new Set(light)].slice(0, 8),
    lowContrast: [...new Set(lowContrast)].slice(0, 8),
  }
}

async function manager() {
  const user = await verifyEmail(await signUp())
  await fs.adminSet(`users/${user.uid}`, {
    email: user.email, onboarded: true, tier: 'pro', businessName: 'Blue Door', roles: [{ id: 'r1', name: 'Barista' }],
    operatingHours: Object.fromEntries(DAY_KEYS.map(k => [k, { open: k === 'monday', start: '07:00', end: '15:00' }])),
    coverage: Object.fromEntries(DAY_KEYS.map(k => [k, { minPeople: k === 'monday' ? 1 : 0 }])),
    notificationPrefs: { language: 'fa' },
  })
  const r = await fs.create(user.idToken, 'employees', { userId: user.uid, name: 'Mira', role: 'Barista', targetHours: 8, timeOff: [], availability: Object.fromEntries(DAY_KEYS.map(k => [k, { available: true, start: '', end: '' }])) })
  expect(r.status).toBe(200)
  const days = Object.fromEntries(DAY_KEYS.map((k, i) => [k, { date: `2026-11-${16 + i}`, shifts: k === 'monday' ? [{ id: 's1', employee: 'Mira', role: 'Barista', start: '07:00', end: '15:00', hours: 8 }] : [] }]))
  await fs.adminSet(`schedules/dark-${Date.now()}`, { userId: user.uid, weekStart: '2026-11-16', createdAt: new Date(), data: { weekStart: '2026-11-16', days, summary: [], issues: [], recommendations: [], checkedRules: null } })
  return user
}

/** Someone who chose Persian and light mode before the switch-off. */
async function withOldPreferences(page) {
  await allowStaging(page)
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('prefs-seeded')) { localStorage.setItem('hengam-language', 'fa'); localStorage.setItem('hengam-theme', 'light'); sessionStorage.setItem('prefs-seeded', '1') }
    } catch { /* empty */ }
  })
}

function expectEnglishDark(r, where) {
  expect.soft(r.appClass, `${where}: dark app`).toMatch(/\bdark\b/)
  expect.soft(r.appClass, `${where}: not light`).not.toMatch(/\blight\b/)
  expect.soft(r.html, `${where}: html background dark`).toBe('rgb(1, 3, 10)')
  expect.soft(r.lang, `${where}: lang`).toBe('en')
  expect.soft(r.rtl, `${where}: no right-to-left`).toBe(0)
  expect.soft(r.persianText, `${where}: no Persian text`).toEqual([])
  expect.soft(r.themeToggle, `${where}: no theme switcher`).toBe(0)
  expect.soft(r.languageToggle, `${where}: no language switcher`).toBe(0)
  expect.soft(r.light, `${where}: no large light surfaces`).toEqual([])
  expect.soft(r.lowContrast, `${where}: readable text`).toEqual([])
  expect.soft(r.savedLanguage, `${where}: saved language kept`).toBe('fa')
  expect.soft(r.savedTheme, `${where}: saved theme kept`).toBe('light')
}

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test(`signed out, ${vp}: every public page is English and dark, old preferences kept`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize(size)
    await withOldPreferences(page)
    for (const path of PUBLIC) {
      await page.goto(path)
      await page.locator('.app').waitFor({ timeout: 15_000 })
      await page.waitForTimeout(400)
      expectEnglishDark(await page.evaluate(audit), `${vp} ${path}`)
    }
  })

  test(`signed in, ${vp}: app pages, menus and dialogs are English and dark`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize(size)
    await withOldPreferences(page)
    const user = await manager()
    await page.goto('/signin')
    await page.locator('input[type=email]').fill(user.email)
    await page.locator('input[type=password]').fill(user.password)
    await page.locator('form button[type=submit]').click()
    await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 20_000 })
    for (const path of SIGNED_IN) {
      await page.goto(path)
      await page.locator('.app').waitFor({ timeout: 15_000 })
      await page.waitForTimeout(800)
      const r = await page.evaluate(audit)
      expectEnglishDark(r, `${vp} ${path}`)
      if (path === '/profile') expect.soft(r.emailLanguageSelect, 'no email-language picker').toBe(0)
    }
    // The account menu and the notification panel.
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Open profile menu' }).click()
    await page.waitForTimeout(300)
    expectEnglishDark(await page.evaluate(audit), `${vp} account menu`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Notifications/ }).first().click()
    await page.waitForTimeout(500)
    expectEnglishDark(await page.evaluate(audit), `${vp} notifications`)
    // A dialog: edit an employee.
    await page.goto('/employees')
    await page.getByRole('button', { name: /Edit/ }).first().click()
    await page.getByRole('dialog').waitFor()
    expectEnglishDark(await page.evaluate(audit), `${vp} edit-employee dialog`)
  })
}

test('onboarding for a new manager is English and dark', async ({ page }) => {
  await withOldPreferences(page)
  const user = await verifyEmail(await signUp())
  await page.goto('/signin')
  await page.locator('input[type=email]').fill(user.email)
  await page.locator('input[type=password]').fill(user.password)
  await page.locator('form button[type=submit]').click()
  await page.waitForURL(/\/onboarding/, { timeout: 20_000 })
  await page.waitForTimeout(800)
  expectEnglishDark(await page.evaluate(audit), 'onboarding')
})

test('no light flash: the document is dark before the app has drawn', async ({ page }) => {
  await withOldPreferences(page)
  await page.route('**/assets/*.js', async (route) => { await new Promise(r => setTimeout(r, 1500)); await route.continue() })
  await page.goto('/pricing', { waitUntil: 'commit' })
  await page.waitForFunction(() => document.body !== null)
  const early = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, app: !!document.querySelector('.app') }))
  expect(early.app).toBe(false)
  expect(early.html).toBe('rgb(1, 3, 10)')
  expect(early.body).toBe('rgb(1, 3, 10)')
})
