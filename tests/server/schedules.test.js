import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'

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

const now = new Date('2026-10-20T12:00:00Z')
const token = (uid) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid })
const call = (fn, uid, input) => fn({ db, uid, token: token(uid), input, now })

async function rejects(promise, status, reason) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message)
    if (reason) assert.equal(err.reason, reason)
    return true
  })
}

// A business in Los Angeles with an owner, an employee who has joined (Ana),
// and one who has not yet (Ben).
async function setup() {
  const { bizId } = await call(ws.createBusiness, 'owner', { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: 'req-setup-1' })
  const ana = await call(ws.createInvite, 'owner', { bizId, name: 'Ana' })
  await call(ws.acceptInvite, 'ana', { code: ana.code })
  const ben = await call(ws.createInvite, 'owner', { bizId, name: 'Ben' })
  return { bizId, ana: ana.staffId, ben: ben.staffId, benCode: ben.code }
}

const shiftOf = async (bizId, id) => (await db.doc(paths.shift(bizId, id)).get()).data()

describe('saving shifts', () => {
  test('stores local times and real instants, and opens a draft week', async () => {
    const { bizId, ana } = await setup()
    const { shiftId, scheduleId, published } = await call(sched.saveShift, 'owner', {
      bizId, staffId: ana, date: '2026-10-21', start: '09:00', end: '17:00', positionName: '  Barista ',
    })
    assert.equal(scheduleId, '2026-10-19')
    assert.equal(published, false)
    const s = await shiftOf(bizId, shiftId)
    assert.equal(s.startAt.toDate().toISOString(), '2026-10-21T16:00:00.000Z')
    assert.equal(s.minutes, 480)
    assert.equal(s.assigneeUid, 'ana')
    assert.equal(s.positionName, 'Barista')
    assert.equal((await db.doc(paths.schedule(bizId, '2026-10-19')).get()).data().status, 'draft')
  })

  test('refuses an overlapping shift for the same person, including overnight', async () => {
    const { bizId, ana, ben } = await setup()
    await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-21', start: '22:00', end: '06:00' })
    await rejects(call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-22', start: '05:00', end: '09:00' }), 409, 'overlap')
    // Back to back is fine, and someone else can work the same hours.
    await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-22', start: '06:00', end: '09:00' })
    await call(sched.saveShift, 'owner', { bizId, staffId: ben, date: '2026-10-22', start: '05:00', end: '09:00' })
  })

  test('editing moves the shift, ignores itself for overlap, and refuses a stale version', async () => {
    const { bizId, ana } = await setup()
    const { shiftId, version } = await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-21', start: '09:00', end: '17:00' })
    const edited = await call(sched.saveShift, 'owner', { bizId, shiftId, expectedVersion: version, staffId: ana, date: '2026-10-21', start: '10:00', end: '18:00' })
    assert.equal(edited.version, 2)
    await rejects(call(sched.saveShift, 'owner', { bizId, shiftId, expectedVersion: version, staffId: ana, date: '2026-10-21', start: '11:00', end: '18:00' }), 409, 'stale')
    const moved = await call(sched.saveShift, 'owner', { bizId, shiftId, staffId: ana, date: '2026-10-27', start: '10:00', end: '18:00' })
    assert.equal(moved.scheduleId, '2026-10-26')
  })

  test('only managers schedule; bad input is explained', async () => {
    const { bizId, ana } = await setup()
    await rejects(call(sched.saveShift, 'ana', { bizId, staffId: ana, date: '2026-10-21', start: '09:00', end: '17:00' }), 403)
    await rejects(call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-21', start: '9am', end: '17:00' }), 400)
    await rejects(call(sched.saveShift, 'owner', { bizId, staffId: 'nobody', date: '2026-10-21', start: '09:00', end: '17:00' }), 404)
  })
})

describe('publishing', () => {
  test('publishes every shift in the week and nothing outside it', async () => {
    const { bizId, ana, ben } = await setup()
    const a = await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-21', start: '09:00', end: '17:00' })
    const b = await call(sched.saveShift, 'owner', { bizId, staffId: ben, date: '2026-10-25', start: '09:00', end: '17:00' })
    const next = await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-26', start: '09:00', end: '17:00' })
    assert.equal((await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-19' })).published, 2)
    assert.equal((await shiftOf(bizId, a.shiftId)).published, true)
    assert.equal((await shiftOf(bizId, b.shiftId)).published, true)
    assert.equal((await shiftOf(bizId, next.shiftId)).published, false)
    // Publishing again is harmless.
    assert.equal((await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-19' })).alreadyPublished, true)
  })

  test('after publishing, new shifts go live and removed ones are cancelled, not deleted', async () => {
    const { bizId, ana } = await setup()
    const a = await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-21', start: '09:00', end: '17:00' })
    await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-19' })
    const late = await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-23', start: '09:00', end: '17:00' })
    assert.equal(late.published, true)
    await call(sched.deleteShift, 'owner', { bizId, shiftId: a.shiftId })
    assert.equal((await shiftOf(bizId, a.shiftId)).status, 'cancelled')
    // A cancelled shift no longer blocks the slot.
    await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-21', start: '10:00', end: '14:00' })
  })

  test('draft shifts are deleted outright; empty and unaligned weeks are refused', async () => {
    const { bizId, ana } = await setup()
    const a = await call(sched.saveShift, 'owner', { bizId, staffId: ana, date: '2026-10-21', start: '09:00', end: '17:00' })
    await call(sched.deleteShift, 'owner', { bizId, shiftId: a.shiftId })
    assert.equal((await db.doc(paths.shift(bizId, a.shiftId)).get()).exists, false)
    await rejects(call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-19' }), 400)
    await rejects(call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-20' }), 400)
    await rejects(call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-11-02' }), 404)
  })
})

test('someone who joins after being scheduled sees the shifts already assigned to them', async () => {
  const { bizId, ben, benCode } = await setup()
  const { shiftId } = await call(sched.saveShift, 'owner', { bizId, staffId: ben, date: '2026-10-21', start: '09:00', end: '17:00' })
  assert.equal((await shiftOf(bizId, shiftId)).assigneeUid, null)
  await call(ws.acceptInvite, 'ben', { code: benCode })
  assert.equal((await shiftOf(bizId, shiftId)).assigneeUid, 'ben')
})

describe('deleting many shifts at once', () => {
  test('drafts go, published shifts are cancelled, and each person hears once per week', async () => {
    const { bizId, ana, ben } = await setup()
    const save = (staffId, date) => call(sched.saveShift, 'owner', { bizId, staffId, date, start: '09:00', end: '13:00' })
    const a1 = await save(ana, '2026-10-26')
    const a2 = await save(ana, '2026-10-27')
    const b1 = await save(ben, '2026-10-27')
    await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-26' })
    const draft = await save(ana, '2026-11-02')

    await rejects(call(sched.deleteShifts, 'ana', { bizId, shiftIds: [a1.shiftId] }), 403)
    await rejects(call(sched.deleteShifts, 'owner', { bizId, shiftIds: [] }), 400)

    const r = await call(sched.deleteShifts, 'owner', { bizId, shiftIds: [a1.shiftId, a2.shiftId, b1.shiftId, draft.shiftId, draft.shiftId] })
    assert.equal(r.removed, 4)
    assert.equal((await shiftOf(bizId, a1.shiftId)).status, 'cancelled')
    assert.equal((await shiftOf(bizId, b1.shiftId)).status, 'cancelled')
    assert.equal(await shiftOf(bizId, draft.shiftId), undefined, 'a draft is simply removed')
    // Ana lost two published shifts in one week: one notice. Ben has no account yet.
    assert.deepEqual(r.notify.map(n => [n.kind, n.to, n.params.weekStart]), [['scheduleChanged', 'ana', '2026-10-26']])
    assert.equal((await db.collection('userBusy/ana/blocks').get()).size, 0, 'off the busy index')

    // Deleting them again changes nothing.
    assert.equal((await call(sched.deleteShifts, 'owner', { bizId, shiftIds: [a1.shiftId] })).removed, 0)
  })
})
