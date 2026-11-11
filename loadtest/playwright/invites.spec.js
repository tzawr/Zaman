import { test, expect } from '@playwright/test'
import { api, commit, fs, signUp, teams, verifyEmail, whereEq } from './helpers.js'

// Invitations end to end, in both products, plus the ordinary manager actions
// that must keep working under the tightened rules. Runs against the
// emulators or staging (E2E_TARGET=staging) unchanged.

const token = () => `e2e${Date.now()}${Math.random().toString(36).slice(2, 10)}`
const docs = async (res) => (await res.json()).filter(x => x.document).map(x => x.document)

test.describe.serial('Hengam web: invite an employee to their schedule', () => {
  let mgr, emp, intruder, employeeId, inviteToken
  test.beforeAll(async () => {
    mgr = await signUp()
    emp = await signUp()
    intruder = await signUp()
    await fs.adminSet(`users/${mgr.uid}`, { email: mgr.email, allowEmployeeFullView: false })
    for (const [name, role] of [['Ana Lima', 'Barista'], ['Ben Ortiz', 'Cashier']]) {
      const r = await fs.create(mgr.idToken, 'employees', { userId: mgr.uid, name, role, targetHours: 30 })
      expect(r.status).toBe(200)
      if (name === 'Ana Lima') employeeId = (await r.json()).name.split('/').pop()
    }
  })

  test('a free manager cannot create invites; a Pro manager can', async () => {
    inviteToken = token()
    const invite = { managerId: mgr.uid, employeeId, employeeName: 'Ana Lima', employeeRole: 'Barista', used: false }
    expect((await fs.patch(mgr.idToken, `invites/${inviteToken}`, invite)).status).toBe(403)
    await fs.adminSet(`users/${mgr.uid}`, { tier: 'pro' })
    expect((await fs.patch(mgr.idToken, `invites/${inviteToken}`, invite)).status).toBe(200)
  })

  test('nobody can list invites, but the holder of a token can read it', async () => {
    expect((await fs.query(intruder.idToken, '', { from: [{ collectionId: 'invites' }], where: whereEq('managerId', mgr.uid) })).status).toBe(403)
    expect((await fs.get(emp.idToken, `invites/${inviteToken}`)).status).toBe(200)
  })

  const claim = (who, tok = inviteToken, empId = employeeId) => commit(who.idToken, [
    { path: `users/${who.uid}`, data: { email: who.email, accountType: 'employee', managerId: mgr.uid, linkedEmployeeId: empId, inviteToken: tok } },
    { path: `invites/${tok}`, data: { used: true, usedBy: who.uid }, serverTime: ['usedAt'] },
  ])

  test('linking to a manager without a valid invite is refused', async () => {
    const r = await commit(intruder.idToken, [
      { path: `users/${intruder.uid}`, data: { accountType: 'employee', managerId: mgr.uid, linkedEmployeeId: employeeId, inviteToken: 'made-up-token' } },
    ])
    expect(r.status).toBe(403)
  })

  test('the employee claims the invite and is linked', async () => {
    expect((await claim(emp)).status).toBe(200)
    const invite = await (await fs.adminGet(`invites/${inviteToken}`)).json()
    expect(invite.fields.used.booleanValue).toBe(true)
    expect(invite.fields.usedBy.stringValue).toBe(emp.uid)
  })

  test('the same invite cannot be claimed a second time', async () => {
    expect((await claim(intruder)).status).toBe(403)
    const user = await fs.adminGet(`users/${intruder.uid}`)
    if (user.status === 200) expect((await user.json()).fields?.managerId).toBeUndefined()
  })

  test('the linked employee sees only their own shifts, through the API', async () => {
    await fs.adminSet(`schedules/e2e-${token()}`, {
      userId: mgr.uid, weekStart: '2026-11-16', createdAt: new Date(),
      data: { days: { monday: { shifts: [
        { employee: 'Ana Lima', start: '09:00', end: '17:00', role: 'Barista', hours: 8 },
        { employee: 'Ben Ortiz', start: '12:00', end: '20:00', role: 'Cashier', hours: 8 },
      ] } } },
    })
    const r = await api('/api/my-schedule', { method: 'GET', token: emp.idToken })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.employeeName).toBe('Ana Lima')
    const shifts = r.body.schedules.flatMap(s => Object.values(s.data?.days || {}).flatMap(d => d.shifts || []))
    expect(shifts.length).toBeGreaterThan(0)
    for (const s of shifts) expect(s.employee).toBe('Ana Lima')
  })

  test("the employee cannot read the manager's team or schedules directly", async () => {
    expect((await fs.query(emp.idToken, '', { from: [{ collectionId: 'employees' }], where: whereEq('userId', mgr.uid) })).status).toBe(403)
    expect((await fs.query(emp.idToken, '', { from: [{ collectionId: 'schedules' }], where: whereEq('userId', mgr.uid) })).status).toBe(403)
  })

  test('an unlinked account gets nothing from my-schedule', async () => {
    expect((await api('/api/my-schedule', { method: 'GET', token: intruder.idToken })).status).toBe(403)
  })

  test('legitimate manager actions still work: edit and delete own records, edit own invite', async () => {
    const list = await docs(await fs.query(mgr.idToken, '', { from: [{ collectionId: 'employees' }], where: whereEq('userId', mgr.uid) }))
    const ben = list.find(d => d.fields.name.stringValue === 'Ben Ortiz').name.split('/documents/')[1]
    expect((await fs.patch(mgr.idToken, ben, { targetHours: 25, role: 'Barista' })).status).toBe(200)
    const extra = await fs.create(mgr.idToken, 'employees', { userId: mgr.uid, name: 'Temp Person' })
    expect((await fs.remove(mgr.idToken, (await extra.json()).name.split('/documents/')[1])).status).toBe(200)
    const t2 = token()
    expect((await fs.patch(mgr.idToken, `invites/${t2}`, { managerId: mgr.uid, employeeId: 'x', employeeName: 'Ben', used: false })).status).toBe(200)
    expect((await fs.patch(mgr.idToken, `invites/${t2}`, { employeeName: 'Ben Ortiz' })).status).toBe(200)
    expect((await fs.remove(mgr.idToken, `invites/${t2}`)).status).toBe(200)
  })
})

test.describe.serial('Hengam Teams: invite codes', () => {
  let owner, ana, mallory, bizId, anaCode, staffId, shiftId
  test.beforeAll(async () => {
    owner = await verifyEmail(await signUp())
    ana = await verifyEmail(await signUp())
    mallory = await verifyEmail(await signUp())
    bizId = (await teams('createBusiness', owner.idToken, { name: 'Delta Diner', timezone: 'America/Los_Angeles', requestId: `e2e-d-${Date.now()}` })).body.bizId
    const inv = await teams('createInvite', owner.idToken, { bizId, name: 'Ana Delta' })
    expect(inv.status).toBe(200)
    anaCode = inv.body.code
    staffId = inv.body.staffId
  })

  test('a signed-out preview shows only what the invite is for', async () => {
    const r = await api('/api/teams/previewInvite', { body: { code: anaCode } })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ businessName: 'Delta Diner', role: expect.any(String), name: 'Ana Delta' })
  })

  test('the invitee accepts and becomes a member', async () => {
    expect((await teams('acceptInvite', ana.idToken, { code: anaCode })).status).toBe(200)
    expect((await fs.get(ana.idToken, `businesses/${bizId}`)).status).toBe(200)
  })

  test('an accepted code is spent: nobody else can use it', async () => {
    const r = await teams('acceptInvite', mallory.idToken, { code: anaCode })
    expect([409, 410]).toContain(r.status)
    expect((await fs.get(mallory.idToken, `businesses/${bizId}`)).status).toBe(403)
  })

  test('a revoked invite cannot be previewed or accepted', async () => {
    const inv = await teams('createInvite', owner.idToken, { bizId, name: 'Revoked Person' })
    expect((await teams('revokeInvite', owner.idToken, { bizId, inviteId: inv.body.inviteId || inv.body.id })).status).toBe(200)
    // Revoking removes the code, so it answers like a code that never existed.
    expect([404, 410]).toContain((await api('/api/teams/previewInvite', { body: { code: inv.body.code } })).status)
    expect([404, 410]).toContain((await teams('acceptInvite', mallory.idToken, { code: inv.body.code })).status)
    expect((await fs.get(mallory.idToken, `businesses/${bizId}`)).status).toBe(403)
  })

  test('the manager schedules, edits with a version, and publishes; the employee sees it only when published', async () => {
    const saved = await teams('saveShift', owner.idToken, { bizId, staffId, date: '2026-12-09', start: '09:00', end: '17:00', positionName: 'Grill' })
    expect(saved.status).toBe(200)
    shiftId = saved.body.shiftId
    const mine = () => fs.query(ana.idToken, `businesses/${bizId}`, { from: [{ collectionId: 'shifts' }], where: { compositeFilter: { op: 'AND', filters: [whereEq('assigneeUid', ana.uid), whereEq('published', true)] } } })
    expect(await docs(await mine())).toHaveLength(0)
    const edited = await teams('saveShift', owner.idToken, { bizId, shiftId, expectedVersion: saved.body.version, staffId, date: '2026-12-09', start: '10:00', end: '18:00', positionName: 'Grill' })
    expect(edited.status).toBe(200)
    expect(edited.body.version).toBe(saved.body.version + 1)
    expect((await teams('publishSchedule', owner.idToken, { bizId, weekStart: '2026-12-07' })).status).toBe(200)
    const visible = await docs(await mine())
    expect(visible).toHaveLength(1)
    expect(visible[0].fields.startLocal.stringValue).toBe('10:00')
  })

  test('an employee cannot schedule, publish or invite', async () => {
    expect([403, 404]).toContain((await teams('saveShift', ana.idToken, { bizId, staffId, date: '2026-12-10', start: '09:00', end: '10:00' })).status)
    expect([403, 404]).toContain((await teams('publishSchedule', ana.idToken, { bizId, weekStart: '2026-12-07' })).status)
    expect([403, 404]).toContain((await teams('createInvite', ana.idToken, { bizId, name: 'Friend' })).status)
  })

  test('the manager can remove a published shift; it is cancelled, not lost', async () => {
    expect((await teams('deleteShift', owner.idToken, { bizId, shiftId })).status).toBe(200)
    const stored = await (await fs.adminGet(`businesses/${bizId}/shifts/${shiftId}`)).json()
    expect(stored.fields.status.stringValue).toBe('cancelled')
  })
})
