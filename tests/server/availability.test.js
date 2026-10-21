import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'
import * as mk from '../../api/_teams-marketplace.js'
import * as av from '../../api/_teams-availability.js'

const PROJECT_ID = 'demo-hengam'
let db
before(() => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
})
after(async () => { await Promise.all(getApps().map(deleteApp)) })
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
})

// Tuesday 20 October 2026, mid-morning in Los Angeles.
const now = new Date('2026-10-20T17:00:00Z')
const token = (uid) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid })
const call = (fn, uid, input) => fn({ db, uid, token: token(uid), input, now })

async function rejects(promise, status, reason) {
  let caught
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message)
    if (reason) assert.equal(err.reason, reason)
    caught = err
    return true
  })
  return caught
}

async function setup() {
  const { bizId } = await call(ws.createBusiness, 'owner', { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: 'req-avail-1' })
  const staff = {}
  for (const name of ['ana', 'ben']) {
    const inv = await call(ws.createInvite, 'owner', { bizId, name })
    await call(ws.acceptInvite, name, { code: inv.code })
    staff[name] = inv.staffId
  }
  return { bizId, staff }
}

const weekdays = { monday: { available: true, windows: [{ start: '9', end: '5pm' }] }, tuesday: { available: false } }
const read = async (path) => (await db.doc(path).get()).data()
let requestCounter = 0
const timeOff = (bizId, uid, extra) => call(av.requestTimeOff, uid, { bizId, requestId: `request-${++requestCounter}-abcd`, category: 'vacation', ...extra })

describe('availability', () => {
  test('an employee saves their own; a change can start later; old versions are pruned', async () => {
    const { bizId, staff } = await setup()
    await call(av.saveAvailability, 'ana', { bizId, weekly: weekdays, preferredHoursPerWeek: 24 })
    await call(av.saveAvailability, 'ana', { bizId, weekly: {}, effectiveFrom: '2026-11-02' })
    const doc = await read(paths.availability(bizId, staff.ana))
    assert.equal(doc.uid, 'ana')
    assert.deepEqual(doc.versions.map(v => v.effectiveFrom), ['2026-10-20', '2026-11-02'])
    assert.deepEqual(doc.versions[0].weekly.monday.windows, [{ start: '09:00', end: '17:00' }])
    assert.equal(doc.versions[0].preferredHoursPerWeek, 24)
    await rejects(call(av.saveAvailability, 'ana', { bizId, weekly: {}, effectiveFrom: '2026-10-01' }), 400)
  })

  test('only managers edit someone else’s, and a business can lock employees out', async () => {
    const { bizId, staff } = await setup()
    await rejects(call(av.saveAvailability, 'ben', { bizId, staffId: staff.ana, weekly: weekdays }), 403)
    await call(av.saveAvailability, 'owner', { bizId, staffId: staff.ana, weekly: weekdays })
    assert.equal((await read(paths.availability(bizId, staff.ana))).updatedByRole, 'manager')
    await call(av.updatePolicies, 'owner', { bizId, employeesCanSubmitAvailability: false })
    await rejects(call(av.saveAvailability, 'ana', { bizId, weekly: weekdays }), 403)
  })

  test('temporary changes cannot overlap and can be removed', async () => {
    const { bizId, staff } = await setup()
    const { overrideId } = await call(av.addAvailabilityOverride, 'ana', { bizId, from: '2026-10-22', to: '2026-10-23', unavailable: true, reason: 'Exams' })
    await rejects(call(av.addAvailabilityOverride, 'ana', { bizId, from: '2026-10-23', to: '2026-10-24', unavailable: true }), 409, 'overlap')
    await call(av.removeAvailabilityOverride, 'ana', { bizId, overrideId })
    assert.deepEqual((await read(paths.availability(bizId, staff.ana))).overrides, [])
  })
})

describe('time off', () => {
  test('a request is idempotent, cannot overlap another, and records the instants it covers', async () => {
    const { bizId } = await setup()
    const input = { bizId, requestId: 'same-request-1', category: 'vacation', startDate: '2026-10-26', endDate: '2026-10-27' }
    const first = await call(av.requestTimeOff, 'ana', input)
    const again = await call(av.requestTimeOff, 'ana', input)
    assert.equal(first.id, again.id)
    assert.equal(again.duplicate, true)
    const r = await read(paths.timeOff(bizId, first.id))
    assert.equal(r.startAt.toDate().toISOString(), '2026-10-26T07:00:00.000Z')
    assert.equal(r.endAt.toDate().toISOString(), '2026-10-28T07:00:00.000Z')
    await rejects(timeOff(bizId, 'ana', { startDate: '2026-10-27', endDate: '2026-10-29' }), 409, 'overlap')
    // Someone else's days are their own.
    await timeOff(bizId, 'ben', { startDate: '2026-10-27', endDate: '2026-10-29' })
  })

  test('part-day requests, and categories from the business policy', async () => {
    const { bizId } = await setup()
    const { id } = await timeOff(bizId, 'ana', { category: 'personal', startDate: '2026-10-22', endDate: '2026-10-22', partialStart: '13:00', partialEnd: '17:00' })
    const r = await read(paths.timeOff(bizId, id))
    assert.deepEqual(r.partial, { start: '13:00', end: '17:00' })
    assert.equal(r.startAt.toDate().toISOString(), '2026-10-22T20:00:00.000Z')
    await rejects(timeOff(bizId, 'ana', { category: 'jury', startDate: '2026-10-30', endDate: '2026-10-30' }), 400)
    await call(av.updatePolicies, 'owner', { bizId, customTimeOffCategories: [{ label: 'Jury duty' }] })
    const policies = await read(paths.policies(bizId))
    const jury = policies.customTimeOffCategories[0].id
    assert.ok(policies.timeOffCategories.includes(jury))
    await timeOff(bizId, 'ana', { category: jury, startDate: '2026-10-30', endDate: '2026-10-30' })
  })

  test('the manager decides; approving reports shifts already scheduled in that time', async () => {
    const { bizId, staff } = await setup()
    await call(sched.saveShift, 'owner', { bizId, staffId: staff.ana, date: '2026-10-26', start: '09:00', end: '17:00' })
    const { id } = await timeOff(bizId, 'ana', { startDate: '2026-10-26', endDate: '2026-10-26' })
    await rejects(call(av.decideTimeOff, 'ben', { bizId, timeOffId: id, approve: true }), 403)
    const result = await call(av.decideTimeOff, 'owner', { bizId, timeOffId: id, approve: true, note: 'Enjoy' })
    assert.equal(result.status, 'approved')
    assert.equal(result.clashingShifts.length, 1)
    await rejects(call(av.decideTimeOff, 'owner', { bizId, timeOffId: id, approve: false }), 409)
    // Approved and still in the future: the person can cancel it.
    await call(av.cancelTimeOff, 'ana', { bizId, timeOffId: id })
    assert.equal((await read(paths.timeOff(bizId, id))).status, 'cancelled')
  })

  test('approved time off blocks picking up a shift in it', async () => {
    const { bizId, staff } = await setup()
    const { shiftId } = await call(sched.saveShift, 'owner', { bizId, staffId: staff.ana, date: '2026-10-23', start: '09:00', end: '17:00' })
    await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-19' })
    const { id } = await timeOff(bizId, 'ben', { startDate: '2026-10-23', endDate: '2026-10-23' })
    await call(av.decideTimeOff, 'owner', { bizId, timeOffId: id, approve: true })
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId })
    const err = await rejects(call(mk.claimOffer, 'ben', { bizId, offerId }), 422)
    assert.equal(err.problems[0].code, 'time_off')
  })
})

describe('policies', () => {
  test('managers change them within bounds, and the change is audited', async () => {
    const { bizId } = await setup()
    await call(av.updatePolicies, 'owner', { bizId, maxHoursPerWeek: 38, minRestHours: '', pickupRequiresApproval: false })
    const p = await read(paths.policies(bizId))
    assert.equal(p.maxHoursPerWeek, 38)
    assert.equal(p.minRestHours, null)
    assert.equal(p.pickupRequiresApproval, false)
    await rejects(call(av.updatePolicies, 'owner', { bizId, maxHoursPerDay: 30 }), 400)
    await rejects(call(av.updatePolicies, 'ana', { bizId, maxHoursPerWeek: 10 }), 403)
    const auditLog = await db.collection(`businesses/${bizId}/auditLog`).where('action', '==', 'policies.updated').get()
    assert.equal(auditLog.size, 1)
    assert.equal(auditLog.docs[0].data().before.maxHoursPerWeek, null)
  })
})
