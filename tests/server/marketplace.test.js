import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'
import * as mk from '../../api/_teams-marketplace.js'

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
  let caught
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message)
    if (reason) assert.equal(err.reason, reason)
    caught = err
    return true
  })
  return caught
}

// Blue Door in Los Angeles: an owner and three employees, with this week
// published. Ana opens Thursday, Ben closes Friday, Cal has Saturday.
async function setup({ policies = {} } = {}) {
  const { bizId } = await call(ws.createBusiness, 'owner', { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: 'req-market-1' })
  const staff = {}
  for (const name of ['ana', 'ben', 'cal']) {
    const inv = await call(ws.createInvite, 'owner', { bizId, name })
    await call(ws.acceptInvite, name, { code: inv.code })
    staff[name] = inv.staffId
  }
  await db.doc(paths.policies(bizId)).set(policies, { merge: true })
  const shift = async (who, date, start, end) =>
    (await call(sched.saveShift, 'owner', { bizId, staffId: staff[who], date, start, end })).shiftId
  const ids = {
    ana: await shift('ana', '2026-10-22', '07:00', '15:00'),
    ben: await shift('ben', '2026-10-23', '14:00', '22:00'),
    cal: await shift('cal', '2026-10-24', '09:00', '17:00'),
  }
  await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-19' })
  return { bizId, staff, ids, shift }
}

const read = async (path) => (await db.doc(path).get()).data()
const busy = async (uid) => (await db.collection(`userBusy/${uid}/blocks`).get()).docs.map(d => d.data().shiftId).sort()

describe('the marketplace', () => {
  test('offer, claim, approve: the shift moves only when the manager approves', async () => {
    const { bizId, ids } = await setup()
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana, note: 'Dentist' })
    assert.equal((await read(paths.shift(bizId, ids.ana))).openOfferId, offerId)

    assert.equal((await call(mk.claimOffer, 'ben', { bizId, offerId })).status, 'pending')
    let shift = await read(paths.shift(bizId, ids.ana))
    assert.equal(shift.assigneeUid, 'ana', 'still Ana’s until approved')
    assert.deepEqual((await read(paths.offer(bizId, offerId))).claimantUids, ['ben'])

    await call(mk.decideClaim, 'owner', { bizId, offerId, claimantUid: 'ben', approve: true })
    shift = await read(paths.shift(bizId, ids.ana))
    assert.equal(shift.assigneeUid, 'ben')
    assert.equal(shift.staffName, 'ben')
    assert.equal(shift.openOfferId, null)
    assert.equal(shift.version, 2) // 1 when created; publishing leaves it; the transfer moves it on
    assert.equal((await read(paths.offer(bizId, offerId))).status, 'completed')
    assert.deepEqual(await busy('ana'), [])
    assert.deepEqual(await busy('ben'), [ids.ana, ids.ben].sort())
  })

  test('approving one claimant closes the others', async () => {
    const { bizId, ids } = await setup()
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })
    await call(mk.claimOffer, 'ben', { bizId, offerId })
    await call(mk.claimOffer, 'cal', { bizId, offerId })
    await call(mk.decideClaim, 'owner', { bizId, offerId, claimantUid: 'cal', approve: true })
    assert.equal((await read(paths.claim(bizId, offerId, 'ben'))).status, 'superseded')
    assert.equal((await read(paths.shift(bizId, ids.ana))).assigneeUid, 'cal')
  })

  test('with no approval needed, three people racing for one shift: exactly one gets it', async () => {
    const { bizId, ids, staff } = await setup({ policies: { pickupRequiresApproval: false } })
    // A fourth claimant, so three can race against the offerer.
    const inv = await call(ws.createInvite, 'owner', { bizId, name: 'dee' })
    await call(ws.acceptInvite, 'dee', { code: inv.code })
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })
    const results = await Promise.allSettled(['ben', 'cal', 'dee'].map(uid => call(mk.claimOffer, uid, { bizId, offerId })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    const shift = await read(paths.shift(bizId, ids.ana))
    assert.notEqual(shift.assigneeUid, 'ana')
    assert.ok([staff.ben, staff.cal, inv.staffId].includes(shift.staffId))
  })

  test('offering twice is one offer; claiming twice is one claim', async () => {
    const { bizId, ids } = await setup()
    const [a, b] = await Promise.all([1, 2].map(() => call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })))
    assert.equal(a.offerId, b.offerId)
    assert.equal((await db.collection(`businesses/${bizId}/offers`).get()).size, 1)
    await call(mk.claimOffer, 'ben', { bizId, offerId: a.offerId })
    assert.equal((await call(mk.claimOffer, 'ben', { bizId, offerId: a.offerId })).alreadyClaimed, true)
  })

  test('a claimant who already works then is refused with the reason', async () => {
    const { bizId, ids, shift } = await setup()
    await shift('ben', '2026-10-22', '12:00', '18:00')
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })
    const preview = await call(mk.previewClaim, 'ben', { bizId, offerId })
    assert.equal(preview.ok, false)
    assert.equal(preview.problems[0].code, 'conflict')
    const err = await rejects(call(mk.claimOffer, 'ben', { bizId, offerId }), 422, 'ineligible')
    assert.match(err.message, /^You already work 12pm – 6pm on Thu, Oct 22/)
  })

  test('a clash at another workplace is caught without telling the manager where', async () => {
    const { bizId, ids } = await setup()
    // Ben also owns a bar, with a published shift Thursday morning.
    const { bizId: bar } = await call(ws.createBusiness, 'ben', { name: 'Bar', timezone: 'America/Los_Angeles', requestId: 'req-bar-0001' })
    const benAtBar = (await read(paths.member(bar, 'ben'))).staffId
    await call(sched.saveShift, 'ben', { bizId: bar, staffId: benAtBar, date: '2026-10-22', start: '08:00', end: '10:00' })
    await call(sched.publishSchedule, 'ben', { bizId: bar, weekStart: '2026-10-19' })

    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })
    const mine = await call(mk.previewClaim, 'ben', { bizId, offerId })
    assert.deepEqual(mine.problems.map(p => p.code), ['conflict_elsewhere'])
    assert.match(mine.problems[0].message, /another workplace/)
    const managers = await call(mk.previewClaim, 'owner', { bizId, offerId, claimantUid: 'ben' })
    assert.equal(managers.problems[0].message, 'ben has another commitment at that time.')
  })

  test('a limit reached between asking and approval is caught at approval', async () => {
    const { bizId, ids, shift } = await setup({ policies: { maxHoursPerWeek: 20 } })
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })
    await call(mk.claimOffer, 'ben', { bizId, offerId }) // 8h + 8h, fine
    await shift('ben', '2026-10-25', '09:00', '15:00') // now 22h with the pickup
    await rejects(call(mk.decideClaim, 'owner', { bizId, offerId, claimantUid: 'ben', approve: true }), 422, 'ineligible')
    assert.equal((await read(paths.shift(bizId, ids.ana))).assigneeUid, 'ana')
  })

  test('editing an offered shift closes the offer; a late claim is refused', async () => {
    const { bizId, ids, staff } = await setup()
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })
    await call(mk.claimOffer, 'ben', { bizId, offerId })
    await call(sched.saveShift, 'owner', { bizId, shiftId: ids.ana, staffId: staff.ana, date: '2026-10-22', start: '08:00', end: '15:00' })
    const offer = await read(paths.offer(bizId, offerId))
    assert.equal(offer.status, 'cancelled')
    assert.equal((await read(paths.claim(bizId, offerId, 'ben'))).status, 'superseded')
    await rejects(call(mk.claimOffer, 'cal', { bizId, offerId }), 409, 'closed')
  })

  test('only the owner of a shift offers it; only managers decide; rejecting reopens', async () => {
    const { bizId, ids } = await setup()
    await rejects(call(mk.offerShift, 'ben', { bizId, shiftId: ids.ana }), 403)
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana })
    await call(mk.claimOffer, 'ben', { bizId, offerId })
    await rejects(call(mk.decideClaim, 'cal', { bizId, offerId, claimantUid: 'ben', approve: true }), 403)
    await rejects(call(mk.claimOffer, 'ana', { bizId, offerId }), 400)
    await call(mk.decideClaim, 'owner', { bizId, offerId, claimantUid: 'ben', approve: false })
    assert.equal((await read(paths.offer(bizId, offerId))).status, 'available')
    await call(mk.cancelOffer, 'ana', { bizId, offerId })
    assert.equal((await read(paths.shift(bizId, ids.ana))).openOfferId, null)
  })
})

describe('swaps', () => {
  test('ask, accept, approve: both shifts change hands together', async () => {
    const { bizId, ids } = await setup()
    const { swapId } = await call(mk.requestSwap, 'ana', { bizId, myShiftId: ids.ana, theirShiftId: ids.ben })
    assert.equal((await read(paths.shift(bizId, ids.ben))).swapId, swapId)
    assert.equal((await call(mk.respondSwap, 'ben', { bizId, swapId, accept: true })).status, 'pending_manager')
    assert.equal((await read(paths.shift(bizId, ids.ana))).assigneeUid, 'ana', 'nothing moves before approval')
    await call(mk.decideSwap, 'owner', { bizId, swapId, approve: true })
    const [a, b] = [await read(paths.shift(bizId, ids.ana)), await read(paths.shift(bizId, ids.ben))]
    assert.equal(a.assigneeUid, 'ben')
    assert.equal(b.assigneeUid, 'ana')
    assert.equal(a.swapId, null)
    assert.equal(b.swapId, null)
    assert.deepEqual(await busy('ana'), [ids.ben])
    assert.deepEqual(await busy('ben'), [ids.ana])
    assert.equal((await read(paths.swap(bizId, swapId))).status, 'completed')
  })

  test('if one side changed before approval, neither side moves', async () => {
    const { bizId, ids, staff } = await setup()
    const { swapId } = await call(mk.requestSwap, 'ana', { bizId, myShiftId: ids.ana, theirShiftId: ids.ben })
    await call(mk.respondSwap, 'ben', { bizId, swapId, accept: true })
    // The manager edits Ben's shift directly, which closes the swap.
    await call(sched.saveShift, 'owner', { bizId, shiftId: ids.ben, staffId: staff.ben, date: '2026-10-23', start: '15:00', end: '22:00' })
    assert.equal((await read(paths.swap(bizId, swapId))).status, 'cancelled')
    await rejects(call(mk.decideSwap, 'owner', { bizId, swapId, approve: true }), 409, 'closed')
    assert.equal((await read(paths.shift(bizId, ids.ana))).assigneeUid, 'ana')
    assert.equal((await read(paths.shift(bizId, ids.ben))).assigneeUid, 'ben')
    assert.equal((await read(paths.shift(bizId, ids.ana))).swapId, null)
  })

  test('without approval the swap completes when the other person accepts', async () => {
    const { bizId, ids } = await setup({ policies: { swapRequiresApproval: false } })
    const { swapId } = await call(mk.requestSwap, 'ana', { bizId, myShiftId: ids.ana, theirShiftId: ids.cal })
    assert.equal((await call(mk.respondSwap, 'cal', { bizId, swapId, accept: true })).status, 'completed')
    assert.equal((await read(paths.shift(bizId, ids.cal))).assigneeUid, 'ana')
  })

  test('declining or cancelling frees both shifts; a locked shift cannot be offered', async () => {
    const { bizId, ids } = await setup()
    const first = await call(mk.requestSwap, 'ana', { bizId, myShiftId: ids.ana, theirShiftId: ids.ben })
    await rejects(call(mk.offerShift, 'ana', { bizId, shiftId: ids.ana }), 409, 'locked')
    await rejects(call(mk.requestSwap, 'cal', { bizId, myShiftId: ids.cal, theirShiftId: ids.ben }), 409, 'locked')
    await call(mk.respondSwap, 'ben', { bizId, swapId: first.swapId, accept: false })
    assert.equal((await read(paths.shift(bizId, ids.ben))).swapId, null)
    const second = await call(mk.requestSwap, 'ana', { bizId, myShiftId: ids.ana, theirShiftId: ids.ben })
    await rejects(call(mk.respondSwap, 'cal', { bizId, swapId: second.swapId, accept: true }), 403)
    await call(mk.cancelSwap, 'ana', { bizId, swapId: second.swapId })
    assert.equal((await read(paths.shift(bizId, ids.ana))).swapId, null)
  })

  test('both directions are validated, and swap candidates explain themselves', async () => {
    const { bizId, ids, shift } = await setup({ policies: { minRestHours: 10 } })
    // Cal closes late Thursday; taking Ana's 7am Friday-style shift would break rest.
    await shift('cal', '2026-10-21', '18:00', '23:00')
    const err = await rejects(call(mk.requestSwap, 'ana', { bizId, myShiftId: ids.ana, theirShiftId: ids.cal }), 422)
    assert.match(err.message, /cal would have less than 10 hours of rest/)
    const { candidates } = await call(mk.listSwapCandidates, 'ana', { bizId, myShiftId: ids.ana })
    assert.deepEqual([...new Set(candidates.map(c => c.staffName))].sort(), ['ben', 'cal'])
    assert.ok(candidates.every(c => c.ok))
  })
})

test('removing someone takes their busy entries for that workplace with them', async () => {
  const { bizId, ids } = await setup()
  assert.deepEqual(await busy('cal'), [ids.cal])
  await call(ws.removeMember, 'owner', { bizId, memberUid: 'cal' })
  assert.deepEqual(await busy('cal'), [])
})
