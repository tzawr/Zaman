import { test, expect } from '@playwright/test'
import { BYPASS, STAGING, fs, signIn, uniqueEmail, verifyEmail, whereEq } from './helpers.js'

// A new manager's first session in the Hengam web app, end to end in a real
// browser against the emulators: sign up, verify, set up the workplace, add a
// team, set availability, generate and save a week, then let an employee in.
// Each step is checked against what Firestore stored, not just the screen.

const PASSWORD = 'e2e-pass-123'

const lookupUid = (email) => signIn(email, PASSWORD)

const docs = async (res) => (await res.json()).filter(x => x.document).map(x => x.document)
const str = (doc, f) => doc.fields?.[f]?.stringValue

test.describe.serial('manager journey', () => {
  const email = uniqueEmail('mgr')
  const journeyStart = new Date()
  let manager
  let page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    // Browser errors go to the test output: a step that silently does
    // nothing usually threw here.
    page.on('pageerror', e => console.log(`[pageerror] ${e.message}`))
    page.on('console', m => { if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 400)}`) })
    // Staging keeps Vercel Deployment Protection on: one visit with the
    // automation bypass sets a cookie for the rest of the session.
    if (STAGING) await page.goto(`/?x-vercel-protection-bypass=${BYPASS['x-vercel-protection-bypass']}&x-vercel-set-bypass-cookie=true`)
  })
  test.afterAll(async () => { await page.close() })

  test('1. signs up and verifies their email', async () => {
    await page.goto('/signup')
    await page.locator('#signup-email').fill(email)
    await page.locator('#signup-password').fill(PASSWORD)
    await page.locator('form.auth-form button[type=submit]').click()
    await expect(page).toHaveURL(/\/verify-email/)
    manager = await verifyEmail(await lookupUid(email))
    // The page polls the account and moves on once it is verified.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 })
  })

  test('2. sets up the workplace', async () => {
    await page.locator('#onboarding-yourName').fill('Maya Manager')
    await page.locator('#onboarding-yourRoleQuestion').fill('Owner')
    // Each step saves before the next appears; wait for it, as a person would.
    const step = (n) => expect(page.locator('.setup-step-count')).toHaveText(`Step ${n} of 7`, { timeout: 20_000 })
    await page.getByRole('button', { name: 'Continue' }).click()
    await step(2)

    await page.getByPlaceholder('e.g. Barista').fill('Barista')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByPlaceholder('e.g. Barista').fill('Cashier')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click() // roles
    await step(3)
    await page.getByRole('button', { name: 'Continue' }).click() // hours (defaults)
    await step(4)
    await page.getByRole('button', { name: 'Continue' }).click() // coverage (optional)
    await step(5)

    const user = await (await fs.get(manager.idToken, `users/${manager.uid}`)).json()
    expect(JSON.stringify(user.fields)).toContain('Barista')
    expect(JSON.stringify(user.fields)).toContain('Cashier')
  })

  test('3. adds employees', async () => {
    for (const [name, role, hours] of [['Ana Lima', 'Barista', '30'], ['Ben Ortiz', 'Cashier', '20'], ['Cleo Park', 'Barista', '25']]) {
      await page.locator('#onboarding-name').fill(name)
      await page.locator('#onboarding-role').selectOption(role)
      await page.locator('#onboarding-targetHoursWeek').fill(hours)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(page.locator('.setup-team-list').getByText(name)).toBeVisible()
      // The form clears itself once the save lands; wait for that before the next person.
      await expect(page.locator('#onboarding-name')).toHaveValue('')
    }
    const stored = await docs(await fs.query(manager.idToken, '', { from: [{ collectionId: 'employees' }], where: whereEq('userId', manager.uid) }))
    expect(stored.map(d => str(d, 'name')).sort()).toEqual(['Ana Lima', 'Ben Ortiz', 'Cleo Park'])
    // Every employee belongs to this manager and nobody else.
    for (const d of stored) expect(str(d, 'userId')).toBe(manager.uid)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('.setup-step-count')).toHaveText('Step 6 of 7', { timeout: 20_000 })
  })

  test('4. finishes setup', async () => {
    // Availability is optional here; it is set from the Employees page next.
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await expect(page.locator('.setup-step-count')).toHaveText('Step 7 of 7', { timeout: 20_000 })
    await page.getByRole('button', { name: /Go to my dashboard|Finish setup/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    const user = await (await fs.get(manager.idToken, `users/${manager.uid}`)).json()
    expect(user.fields.onboarded?.booleanValue).toBe(true)
  })

  test('5. configures availability for each employee', async () => {
    const team = await docs(await fs.query(manager.idToken, '', { from: [{ collectionId: 'employees' }], where: whereEq('userId', manager.uid) }))
    for (const emp of team) {
      const id = emp.name.split('/').pop()
      await page.goto(`/employees/${id}/availability`)
      await page.getByRole('button', { name: /Availability Sunday/ }).click()
      await page.locator('.avail-save-btn').first().click()
      await expect(page.locator('.avail-save-btn').first()).toHaveText(/Saved/)
      const stored = await (await fs.get(manager.idToken, `employees/${id}`)).json()
      const sunday = stored.fields.availability?.mapValue?.fields?.sunday
      expect(sunday, `availability saved for ${str(emp, 'name')}`).toBeTruthy()
      expect(JSON.stringify(sunday)).not.toContain('"available":{"booleanValue":true}')
    }
  })

  test('6. generates a schedule that only uses this team, and saves it', async () => {
    await page.goto('/schedule')
    await expect(page.locator('.gen-stat-value').first()).toHaveText('3', { timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Generate schedule' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Generate schedule' }).click()
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 30_000 })
    const saved = await docs(await fs.query(manager.idToken, '', { from: [{ collectionId: 'schedules' }], where: whereEq('userId', manager.uid) }))
    expect(saved.length).toBeGreaterThanOrEqual(1)
    const content = JSON.parse(str(saved[0], 'content'))
    const team = new Set(['Ana Lima', 'Ben Ortiz', 'Cleo Park'])
    const shifts = Object.values(content.days || {}).flatMap(d => d.shifts || [])
    expect(shifts.length).toBeGreaterThan(0)
    for (const s of shifts) expect(team.has(s.employee), `unknown person ${s.employee}`).toBe(true)
  })

  const schedules = async () => docs(await fs.query(manager.idToken, '', { from: [{ collectionId: 'schedules' }], where: whereEq('userId', manager.uid) }))
  const newest = (list) => list.sort((x, y) => String(y.fields.createdAt?.timestampValue).localeCompare(String(x.fields.createdAt?.timestampValue)))[0]
  const instructions = () => page.locator('textarea.ai-instr-textarea')
  const ai = (status, body) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const BUSY = { error: 'Busy', message: 'The scheduling service is busy right now. Try again in a moment.' }
  const RULES_OK = { scheduleText: '{"employeeRules":{"maxDays":{"Ana Lima":4}}}' }

  test('7. free plan: written instructions are not applied, and the schedule says so', async () => {
    await page.goto('/schedule')
    await instructions().fill('Ana never works Mondays (free plan)')
    await expect(page.getByRole('button', { name: 'Generate schedule' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Generate schedule' }).click()
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/were not applied: they need the Pro plan/)).toBeVisible()
    const latest = newest(await schedules())
    expect(latest.fields.rulesApplied?.booleanValue).toBe(false)
    expect(str(latest, 'rulesSkippedReason')).toBe('plan')
  })

  test('8. Pro: when reading the rules fails, nothing is generated and the manager is told', async () => {
    await fs.adminSet(`users/${manager.uid}`, { tier: 'pro' })
    const before = (await schedules()).length
    let calls = 0
    await page.route('**/api/generate-schedule', (route) => { calls++; return ai(503, BUSY)(route) })
    await page.goto('/schedule')
    await instructions().fill('Ana never works Mondays (outage)')
    await expect(page.getByRole('button', { name: 'Generate schedule' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Generate schedule' }).click()
    const panel = page.locator('.rule-failure')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText('could not be read')
    await expect(panel).toContainText('No schedule was generated or saved')
    await page.locator('.gen-cta-wrap').screenshot({ path: test.info().outputPath('rule-failure-panel.png') })
    await expect(page.locator('.schedule-output-section')).toHaveCount(0)
    expect(calls).toBe(1)
    expect((await schedules()).length, 'nothing saved').toBe(before)

    // Retry goes back to the service, and still saves nothing while it is down.
    await panel.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => calls).toBe(2)
    await expect(panel).toBeVisible()
    expect((await schedules()).length).toBe(before)
    await page.unroute('**/api/generate-schedule')
  })

  test('9. Pro: retry after the service recovers applies the rules', async () => {
    await page.route('**/api/generate-schedule', ai(503, BUSY))
    await page.goto('/schedule')
    await instructions().fill('Ana works at most four days (recovery)')
    await expect(page.getByRole('button', { name: 'Generate schedule' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Generate schedule' }).click()
    await expect(page.locator('.rule-failure')).toBeVisible({ timeout: 20_000 })
    await page.unroute('**/api/generate-schedule')
    await page.route('**/api/generate-schedule', ai(200, RULES_OK))
    await page.locator('.rule-failure').getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.rule-failure')).toHaveCount(0)
    await expect(page.locator('.rules-skipped-banner')).toHaveCount(0)
    const latest = newest(await schedules())
    expect(latest.fields.rulesApplied?.booleanValue).toBe(true)
    await page.unroute('**/api/generate-schedule')
  })

  test('10. Pro: continuing without the instructions is explicit and recorded', async () => {
    const before = (await schedules()).length
    await page.route('**/api/generate-schedule', ai(502, { error: 'x' }))
    await page.goto('/schedule')
    await instructions().fill('Ana never works Mondays (continue without)')
    await expect(page.getByRole('button', { name: 'Generate schedule' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Generate schedule' }).click()
    await page.locator('.rule-failure').getByRole('button', { name: 'Continue without my instructions' }).click()
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.rules-skipped-banner')).toContainText('as you chose')
    const all = await schedules()
    expect(all.length).toBe(before + 1)
    const latest = newest(all)
    expect(latest.fields.rulesApplied?.booleanValue).toBe(false)
    expect(str(latest, 'rulesSkippedReason')).toBe('manager_choice')
    await page.unroute('**/api/generate-schedule')
  })

  test('11. Pro: at the usage limit there is no pointless retry, only the explicit choice', async () => {
    await page.route('**/api/generate-schedule', ai(429, { error: 'Limit reached', message: 'It resets tomorrow.' }))
    await page.goto('/schedule')
    await instructions().fill('Ana never works Mondays (limit)')
    await expect(page.getByRole('button', { name: 'Generate schedule' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Generate schedule' }).click()
    const panel = page.locator('.rule-failure')
    await expect(panel).toContainText('reached your limit')
    await expect(panel).toContainText('It resets tomorrow.')
    await expect(panel.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Continue without my instructions' })).toBeVisible()
    await page.unroute('**/api/generate-schedule')
  })

  test('12. Pro: a garbled reply is treated as a failure, not as "no rules"', async () => {
    const before = (await schedules()).length
    await page.route('**/api/generate-schedule', ai(200, { scheduleText: 'Sorry, I could not do that.' }))
    await page.goto('/schedule')
    await instructions().fill('Ana never works Mondays (garbled)')
    await expect(page.getByRole('button', { name: 'Generate schedule' })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Generate schedule' }).click()
    await expect(page.locator('.rule-failure')).toContainText('could not be used')
    expect((await schedules()).length).toBe(before)
    await page.unroute('**/api/generate-schedule')
  })

  test('13. failures people hit are reported to monitoring, with no personal data', async () => {
    const r = await fs.adminQuery({ from: [{ collectionId: 'errorEvents' }] })
    const events = (await r.json()).filter(x => x.document).map(x => x.document.fields)
    const where = events.map(e => e.where?.stringValue)
    expect(where).toContain('schedule.rules.unavailable')
    expect(where).toContain('schedule.rules.unreadable')
    // Limit and expired-session refusals are the account's state, not faults.
    // Staging keeps events from earlier runs (monitoring.spec simulates an
    // Auth outage on purpose), so only this run's events count here.
    const mine = events.filter(e => !STAGING || new Date(e.lastSeen?.timestampValue) >= journeyStart)
    expect(mine.map(e => e.where?.stringValue).filter(w => /limit|signin/.test(w))).toHaveLength(0)
    const text = JSON.stringify(events)
    expect(text).not.toContain(manager.email)
    expect(text).not.toContain('Ana never works')
  })
})
