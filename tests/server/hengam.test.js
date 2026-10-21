import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'
import * as mk from '../../api/_teams-marketplace.js'
import * as hg from '../../api/_teams-hengam.js'

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

const now = new Date('2026-10-20T17:00:00Z')
const token = (uid) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid })
const call = (fn, uid, input) => fn({ db, uid, token: token(uid), input, now })
const BIZ = 'hengam-mgr'

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

// A Hengam workspace as Hengam stores it: the manager's profile, three
// employees, and Ana already using Hengam's employee portal.
async function hengamWorkspace() {
  const batch = db.batch()
  batch.set(db.doc('users/mgr'), { businessName: 'Blue Door', displayName: 'Maya', email: 'mgr@x.test' })
  batch.set(db.doc('employees/e1'), { userId: 'mgr', name: 'Ana', role: 'Barista' })
  batch.set(db.doc('employees/e2'), { userId: 'mgr', name: 'Ben', role: 'Floor' })
  batch.set(db.doc('employees/e3'), { userId: 'mgr', name: 'Cal', role: '' })
  batch.set(db.doc('users/ana'), { accountType: 'employee', managerId: 'mgr', linkedEmployeeId: 'e1' })
  await batch.commit()
}

const week = (overrides = {}) => ({
  days: {
    monday: { date: '2026-10-26', shifts: [
      { id: 'mo0', employee: 'Ana', role: 'Barista', start: '07:00', end: '15:00', hours: 8 },
      { id: 'mo1', employee: 'Ben', role: 'Floor', start: '11:00', end: '19:00', hours: 8 },
    ] },
    wednesday: { date: '2026-10-28', shifts: [{ id: 'we0', employee: 'Cal', start: '18:00', end: '26:00', hours: 8 }] },
    ...overrides,
  },
})

async function hengamSchedule(id, data) {
  await db.doc(`schedules/${id}`).set({ userId: 'mgr', weekStart: '2026-10-26', data, content: JSON.stringify(data) })
}

const read = async (path) => (await db.doc(path).get()).data()
const shiftId = (day, i) => `h_2026-10-26_${day}_${i}`

describe('connecting', () => {
  test('creates one business with the roster, and brings existing portal users in', async () => {
    await hengamWorkspace()
    const r = await call(hg.hengamConnect, 'mgr', { timezone: 'America/Los_Angeles' })
    assert.deepEqual([r.bizId, r.created, r.employees, r.linked], [BIZ, true, 3, 1])
    assert.equal((await read(paths.business(BIZ))).mode, 'hengam')
    assert.deepEqual((await read(paths.staff(BIZ, 'e2'))).positionNames, ['Floor'])
    assert.equal((await read(paths.staff(BIZ, 'e1'))).uid, 'ana')
    assert.equal((await read(paths.member(BIZ, 'ana'))).staffId, 'e1')
    assert.equal((await read(paths.workplace('ana', BIZ))).name, 'Blue Door')
    assert.equal((await read('users/mgr')).teamsBizId, BIZ)
    assert.equal((await call(hg.hengamConnect, 'mgr', { timezone: 'UTC' })).created, false)
  })

  test('only a Hengam owner can connect', async () => {
    await hengamWorkspace()
    await rejects(call(hg.hengamConnect, 'ana', { timezone: 'UTC' }), 403)
    await rejects(call(hg.hengamConnect, 'mgr', { timezone: 'Nowhere' }), 400)
  })
})

describe('publishing from Hengam', () => {
  test('a week becomes Teams shifts; republishing the same week changes nothing', async () => {
    await hengamWorkspace()
    await call(hg.hengamConnect, 'mgr', { timezone: 'America/Los_Angeles' })
    await hengamSchedule('s1', week())
    const r = await call(hg.hengamPublish, 'mgr', { scheduleId: 's1' })
    assert.deepEqual([r.created, r.updated, r.cancelled], [3, 0, 0])
    const ana = await read(paths.shift(BIZ, shiftId('monday', 0)))
    assert.deepEqual([ana.staffId, ana.assigneeUid, ana.published, ana.origin], ['e1', 'ana', true, 'hengam'])
    const cal = await read(paths.shift(BIZ, shiftId('wednesday', 0)))
    assert.deepEqual([cal.startLocal, cal.endLocal, cal.overnight, cal.minutes], ['18:00', '02:00', true, 480])
    assert.equal((await read(paths.schedule(BIZ, '2026-10-26'))).source, 'hengam')
    assert.ok((await read('schedules/s1')).teamsPublishedAt)
    assert.equal((await call(hg.hengamPublish, 'mgr', { scheduleId: 's1' })).unchanged, true)
  })

  test('a changed week updates, cancels and adds exactly what changed', async () => {
    await hengamWorkspace()
    await call(hg.hengamConnect, 'mgr', { timezone: 'America/Los_Angeles' })
    await hengamSchedule('s1', week())
    await call(hg.hengamPublish, 'mgr', { scheduleId: 's1' })
    // A regenerated week in Hengam is a new schedule document.
    await hengamSchedule('s2', week({
      wednesday: { date: '2026-10-28', shifts: [] },
      friday: { date: '2026-10-30', shifts: [{ employee: 'Cal', start: '09:00', end: '17:00' }] },
    }))
    const data = (await read('schedules/s2')).data
    data.days.monday.shifts[1].start = '12:00'
    await db.doc('schedules/s2').update({ data })
    const r = await call(hg.hengamPublish, 'mgr', { scheduleId: 's2' })
    assert.deepEqual([r.created, r.updated, r.cancelled], [1, 1, 1])
    assert.equal((await read(paths.shift(BIZ, shiftId('monday', 0)))).version, 1, 'unchanged shift untouched')
    assert.equal((await read(paths.shift(BIZ, shiftId('monday', 0)))).hengamRef.scheduleId, 's2')
    assert.equal((await read(paths.shift(BIZ, shiftId('monday', 1)))).startLocal, '12:00')
    assert.equal((await read(paths.shift(BIZ, shiftId('wednesday', 0)))).status, 'cancelled')
  })

  test('names Hengam cannot match stop the publish with the reason', async () => {
    await hengamWorkspace()
    await call(hg.hengamConnect, 'mgr', { timezone: 'America/Los_Angeles' })
    await hengamSchedule('s1', week({ friday: { date: '2026-10-30', shifts: [{ employee: 'Dana', start: '09:00', end: '17:00' }] } }))
    const err = await rejects(call(hg.hengamPublish, 'mgr', { scheduleId: 's1' }), 422, 'unmatched')
    assert.match(err.message, /No employee named “Dana”/)
    assert.equal((await db.collection(`businesses/${BIZ}/shifts`).get()).size, 0, 'nothing half-published')
  })

  test('publishing needs a connected workspace and your own schedule', async () => {
    await hengamWorkspace()
    await hengamSchedule('s1', week())
    await rejects(call(hg.hengamPublish, 'mgr', { scheduleId: 's1' }), 409, 'not_connected')
    await call(hg.hengamConnect, 'mgr', { timezone: 'America/Los_Angeles' })
    await rejects(call(hg.hengamPublish, 'ana', { scheduleId: 's1' }), 404)
  })

  test('Teams will not edit a Hengam schedule, and invites go to people on the Hengam roster', async () => {
    await hengamWorkspace()
    await call(hg.hengamConnect, 'mgr', { timezone: 'America/Los_Angeles' })
    await rejects(call(sched.saveShift, 'mgr', { bizId: BIZ, staffId: 'e2', date: '2026-10-27', start: '09:00', end: '17:00' }), 409, 'hengam_owned')
    await rejects(call(sched.publishSchedule, 'mgr', { bizId: BIZ, weekStart: '2026-10-26' }), 409, 'hengam_owned')
    await rejects(call(ws.createInvite, 'mgr', { bizId: BIZ, name: 'Someone New' }), 400)
    const { code } = await call(ws.createInvite, 'mgr', { bizId: BIZ, staffId: 'e2' })
    await call(ws.acceptInvite, 'ben', { code })
    assert.equal((await read(paths.member(BIZ, 'ben'))).staffId, 'e2')
  })
})

describe('transfers write back to Hengam', () => {
  async function published() {
    await hengamWorkspace()
    await call(hg.hengamConnect, 'mgr', { timezone: 'America/Los_Angeles' })
    for (const [uid, staffId] of [['ben', 'e2'], ['cal', 'e3']]) {
      const { code } = await call(ws.createInvite, 'mgr', { bizId: BIZ, staffId })
      await call(ws.acceptInvite, uid, { code })
    }
    await hengamSchedule('s1', week())
    await call(hg.hengamPublish, 'mgr', { scheduleId: 's1' })
  }

  test('an approved pickup renames the Hengam slot, and republishing finds nothing to do', async () => {
    await published()
    const { offerId } = await call(mk.offerShift, 'ana', { bizId: BIZ, shiftId: shiftId('monday', 0) })
    await call(mk.claimOffer, 'cal', { bizId: BIZ, offerId })
    await call(mk.decideClaim, 'mgr', { bizId: BIZ, offerId, claimantUid: 'cal', approve: true })
    const hengam = await read('schedules/s1')
    assert.equal(hengam.data.days.monday.shifts[0].employee, 'Cal')
    assert.equal(JSON.parse(hengam.content).days.monday.shifts[0].employee, 'Cal')
    const before = await read(paths.shift(BIZ, shiftId('monday', 0)))
    const r = await call(hg.hengamPublish, 'mgr', { scheduleId: 's1' })
    assert.deepEqual([r.created, r.updated, r.cancelled], [0, 0, 0])
    assert.equal((await read(paths.shift(BIZ, shiftId('monday', 0)))).version, before.version)
  })

  test('a swap renames both slots in one transaction', async () => {
    await published()
    const { swapId } = await call(mk.requestSwap, 'ana', { bizId: BIZ, myShiftId: shiftId('monday', 0), theirShiftId: shiftId('wednesday', 0) })
    await call(mk.respondSwap, 'cal', { bizId: BIZ, swapId, accept: true })
    await call(mk.decideSwap, 'mgr', { bizId: BIZ, swapId, approve: true })
    const days = (await read('schedules/s1')).data.days
    assert.equal(days.monday.shifts[0].employee, 'Cal')
    assert.equal(days.wednesday.shifts[0].employee, 'Ana')
  })

  test('a transfer is refused if the week was edited in Hengam after publishing', async () => {
    await published()
    const { offerId } = await call(mk.offerShift, 'ana', { bizId: BIZ, shiftId: shiftId('monday', 0) })
    await call(mk.claimOffer, 'ben', { bizId: BIZ, offerId }).catch(() => {}) // Ben works Monday already
    await call(mk.claimOffer, 'cal', { bizId: BIZ, offerId })
    const data = (await read('schedules/s1')).data
    data.days.monday.shifts[0].start = '06:00'
    await db.doc('schedules/s1').update({ data })
    await rejects(call(mk.decideClaim, 'mgr', { bizId: BIZ, offerId, claimantUid: 'cal', approve: true }), 409, 'hengam_changed')
    assert.equal((await read(paths.shift(BIZ, shiftId('monday', 0)))).assigneeUid, 'ana')
    assert.equal((await read('schedules/s1')).data.days.monday.shifts[0].employee, 'Ana')
  })

  test('republishing a changed shift closes the offer on it', async () => {
    await published()
    const { offerId } = await call(mk.offerShift, 'ana', { bizId: BIZ, shiftId: shiftId('monday', 0) })
    const data = (await read('schedules/s1')).data
    data.days.monday.shifts[0].end = '14:00'
    await db.doc('schedules/s1').update({ data })
    await call(hg.hengamPublish, 'mgr', { scheduleId: 's1' })
    assert.equal((await read(paths.offer(BIZ, offerId))).status, 'cancelled')
    assert.equal((await read(paths.shift(BIZ, shiftId('monday', 0)))).openOfferId, null)
  })
})
