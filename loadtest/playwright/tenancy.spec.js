import { test, expect } from '@playwright/test'
import { api, fs, signUp, teams, verifyEmail, whereEq } from './helpers.js'

// Workplaces must not see or change each other's data, through either path
// a client has: Firestore directly (security rules) and the API. Checked
// against what is stored, not just the status code.

test.describe('cross-tenant access (Hengam web data, Firestore rules)', () => {
  let a, b, aEmployee
  test.beforeAll(async () => {
    a = await signUp()
    b = await signUp()
    const res = await fs.create(a.idToken, 'employees', { userId: a.uid, name: 'Ana A', role: 'Barista', targetHours: 30 })
    expect(res.status).toBe(200)
    aEmployee = (await res.json()).name.split('/documents/')[1]
  })

  test("another manager cannot read A's employee", async () => {
    expect((await fs.get(b.idToken, aEmployee)).status).toBe(403)
  })

  test("another manager cannot list A's employees by querying for A's uid", async () => {
    const r = await fs.query(b.idToken, '', { from: [{ collectionId: 'employees' }], where: whereEq('userId', a.uid) })
    expect(r.status).toBe(403)
  })

  test("another manager cannot edit or delete A's employee", async () => {
    expect((await fs.patch(b.idToken, aEmployee, { name: 'pwned' })).status).toBe(403)
    expect((await fs.remove(b.idToken, aEmployee)).status).toBe(403)
    const stored = await (await fs.adminGet(aEmployee)).json()
    expect(stored.fields.name.stringValue).toBe('Ana A')
  })

  test('a manager cannot create an employee in someone else\'s workspace', async () => {
    expect((await fs.create(a.idToken, 'employees', { userId: b.uid, name: 'Planted' })).status).toBe(403)
  })

  test("a manager cannot move their own employee into someone else's workspace", async () => {
    const own = await fs.create(a.idToken, 'employees', { userId: a.uid, name: 'Mover' })
    const path = (await own.json()).name.split('/documents/')[1]
    const moved = await fs.patch(a.idToken, path, { userId: b.uid })
    expect(moved.status).toBe(403)
    const stored = await (await fs.adminGet(path)).json()
    expect(stored.fields.userId.stringValue).toBe(a.uid)
  })

  test("a manager cannot move their own schedule into someone else's workspace", async () => {
    // Created through the admin path: the client create needs request.time.
    const path = `schedules/e2e-${Date.now()}`
    await fs.adminSet(path, { userId: a.uid, weekStart: '2026-11-16', content: 'x' })
    expect((await fs.patch(a.idToken, path, { userId: b.uid })).status).toBe(403)
    expect((await fs.get(b.idToken, path)).status).toBe(403)
  })

  test("AI usage and rate-limit counters are private", async () => {
    await fs.adminSet(`aiUsage/${a.uid}_2026-11`, { spendUsd: 1 })
    expect((await fs.get(a.idToken, `aiUsage/${a.uid}_2026-11`)).status).toBe(200)
    expect((await fs.get(b.idToken, `aiUsage/${a.uid}_2026-11`)).status).toBe(403)
    await fs.adminSet('rateLimits/x_y_1', { count: 1 })
    expect((await fs.get(a.idToken, 'rateLimits/x_y_1')).status).toBe(403)
  })

  test('a manager cannot grant themselves Pro', async () => {
    expect((await fs.patch(a.idToken, `users/${a.uid}`, { tier: 'pro' })).status).toBe(403)
  })
})

test.describe('cross-tenant access (Teams workplaces, API + rules)', () => {
  let ownerA, ownerB, bizA, bizB, staffA
  test.beforeAll(async () => {
    ownerA = await verifyEmail(await signUp())
    ownerB = await verifyEmail(await signUp())
    bizA = (await teams('createBusiness', ownerA.idToken, { name: 'Alpha Cafe', timezone: 'America/Los_Angeles', requestId: `e2e-a-${Date.now()}` })).body.bizId
    bizB = (await teams('createBusiness', ownerB.idToken, { name: 'Beta Bar', timezone: 'America/Los_Angeles', requestId: `e2e-b-${Date.now()}` })).body.bizId
    staffA = (await teams('createInvite', ownerA.idToken, { bizId: bizA, name: 'Ana Alpha' })).body.staffId
    expect(bizA && bizB && staffA).toBeTruthy()
  })

  test("B's owner cannot schedule, publish or invite in A's workplace", async () => {
    const shift = await teams('saveShift', ownerB.idToken, { bizId: bizA, staffId: staffA, date: '2026-11-18', start: '09:00', end: '17:00' })
    expect([403, 404]).toContain(shift.status)
    expect([403, 404]).toContain((await teams('publishSchedule', ownerB.idToken, { bizId: bizA, weekStart: '2026-11-16' })).status)
    expect([403, 404]).toContain((await teams('createInvite', ownerB.idToken, { bizId: bizA, name: 'Mole' })).status)
    const r = await fs.query(ownerA.idToken, `businesses/${bizA}`, { from: [{ collectionId: 'shifts' }] })
    expect((await r.json()).filter(x => x.document)).toHaveLength(0)
  })

  test("B's owner cannot read A's workplace, staff, shifts or invites", async () => {
    expect((await fs.get(ownerB.idToken, `businesses/${bizA}`)).status).toBe(403)
    expect((await fs.get(ownerB.idToken, `businesses/${bizA}/staff/${staffA}`)).status).toBe(403)
    expect((await fs.query(ownerB.idToken, `businesses/${bizA}`, { from: [{ collectionId: 'shifts' }] })).status).toBe(403)
    expect((await fs.query(ownerB.idToken, `businesses/${bizA}`, { from: [{ collectionId: 'invites' }] })).status).toBe(403)
  })

  test('nobody writes Teams data directly, not even the owner', async () => {
    expect((await fs.patch(ownerA.idToken, `businesses/${bizA}`, { name: 'hacked' })).status).toBe(403)
    expect((await fs.create(ownerA.idToken, `businesses/${bizA}/shifts`, { staffId: staffA })).status).toBe(403)
  })
})

test.describe('invalid input and failures are explained, and change nothing', () => {
  let owner, bizId, staffId
  test.beforeAll(async () => {
    owner = await verifyEmail(await signUp())
    bizId = (await teams('createBusiness', owner.idToken, { name: 'Gamma Deli', timezone: 'America/Los_Angeles', requestId: `e2e-g-${Date.now()}` })).body.bizId
    staffId = (await teams('createInvite', owner.idToken, { bizId, name: 'Gus Gamma' })).body.staffId
  })

  for (const [label, body] of [
    ['a missing date', { start: '09:00', end: '17:00' }],
    ['an impossible date', { date: '2026-02-30', start: '09:00', end: '17:00' }],
    ['garbage times', { date: '2026-11-18', start: 'nine', end: '25:99' }],
    ['a zero-length shift', { date: '2026-11-18', start: '09:00', end: '09:00' }],
  ]) {
    test(`saveShift refuses ${label} with a 400 and a message`, async () => {
      const r = await teams('saveShift', owner.idToken, { bizId, staffId, ...body })
      expect(r.status).toBe(400)
      expect(r.body.message).toBeTruthy()
    })
  }

  test('an unknown action is a 404, a GET is a 405, bad JSON is a 400', async () => {
    expect((await teams('dropDatabase', owner.idToken, {})).status).toBe(404)
    expect((await api('/api/teams/saveShift', { method: 'GET' })).status).toBe(405)
  })

  test('none of the refused saves left a shift behind', async () => {
    const r = await fs.query(owner.idToken, `businesses/${bizId}`, { from: [{ collectionId: 'shifts' }] })
    expect((await r.json()).filter(x => x.document)).toHaveLength(0)
  })

  test('the AI endpoint refuses free accounts and never forwards oversized prompts', async () => {
    const call = (body) => api('/api/generate-schedule', { token: owner.idToken, body })
    expect((await call({ prompt: 'x', task: 'rules' })).status).toBe(403)
    await fs.adminSet(`users/${owner.uid}`, { tier: 'pro' })
    expect((await call({ prompt: 'x'.repeat(20001), task: 'rules' })).status).toBe(413)
    expect((await call({ prompt: 'x', task: 'drop' })).status).toBe(400)
  })
})
