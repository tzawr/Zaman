import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'

// The workflows against the Firestore emulator, through the Admin SDK exactly
// as the endpoints run them.

const PROJECT_ID = 'demo-hengam'
let db
before(() => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
  initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
})
after(async () => { await Promise.all(getApps().map(deleteApp)) })
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
})

const now = new Date('2026-10-20T12:00:00Z')
const token = (uid, extra = {}) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid.toUpperCase(), ...extra })
const call = (fn, uid, input, at = now) => fn({ db, uid, token: uid ? token(uid) : null, input, now: at })

async function rejects(promise, status, reason) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message)
    if (reason) assert.equal(err.reason, reason)
    return true
  })
}

async function newBusiness(uid = 'owner') {
  const { bizId } = await call(ws.createBusiness, uid, { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: `req-${uid}-1` })
  return bizId
}

async function invite(bizId, by, input) {
  return call(ws.createInvite, by, { bizId, name: 'Ana', role: 'employee', ...input })
}

describe('creating a workspace', () => {
  test('sets up the business, owner membership, roster entry, policies and mirror together', async () => {
    const bizId = await newBusiness()
    const member = (await db.doc(paths.member(bizId, 'owner')).get()).data()
    assert.equal(member.role, 'owner')
    assert.equal(member.status, 'active')
    const staff = (await db.doc(paths.staff(bizId, member.staffId)).get()).data()
    assert.equal(staff.uid, 'owner')
    assert.equal((await db.doc(paths.policies(bizId)).get()).data().employeeFullView, false)
    assert.equal((await db.doc(paths.workplace('owner', bizId)).get()).data().name, 'Blue Door')
    assert.equal((await db.collection(`businesses/${bizId}/auditLog`).get()).size, 1)
  })

  test('the same request twice makes one workspace', async () => {
    const input = { name: 'Blue Door', timezone: 'UTC', requestId: 'double-tap-1' }
    const [a, b] = await Promise.all([call(ws.createBusiness, 'owner', input), call(ws.createBusiness, 'owner', input)])
    assert.equal(a.bizId, b.bizId)
    assert.equal((await db.collection('businesses').get()).size, 1)
  })

  test('needs a verified email, a name and a real time zone', async () => {
    await rejects(ws.createBusiness({ db, uid: 'x', token: token('x', { email_verified: false }), input: { name: 'A', timezone: 'UTC', requestId: 'abcdefgh' }, now }), 403)
    await rejects(call(ws.createBusiness, 'x', { name: ' ', timezone: 'UTC', requestId: 'abcdefgh' }), 400)
    await rejects(call(ws.createBusiness, 'x', { name: 'A', timezone: 'Nowhere/Place', requestId: 'abcdefgh' }), 400)
    await rejects(call(ws.createBusiness, 'x', { name: 'A', timezone: 'UTC', requestId: '../../x' }), 400)
  })
})

describe('invites', () => {
  test('an invite adds a roster entry and a code that previews and accepts', async () => {
    const bizId = await newBusiness()
    const { code, staffId } = await invite(bizId, 'owner')
    assert.match(code, /^[0-9A-Z]{10}$/)
    assert.deepEqual(await call(ws.previewInvite, null, { code: code.toLowerCase() }),
      { businessName: 'Blue Door', role: 'employee', name: 'Ana' })

    const joined = await call(ws.acceptInvite, 'ana', { code })
    assert.equal(joined.bizId, bizId)
    const member = (await db.doc(paths.member(bizId, 'ana')).get()).data()
    assert.deepEqual([member.role, member.status, member.staffId], ['employee', 'active', staffId])
    assert.equal((await db.doc(paths.staff(bizId, staffId)).get()).data().uid, 'ana')
    assert.equal((await db.doc(paths.workplace('ana', bizId)).get()).data().role, 'employee')
  })

  test('a code works once: the same person again is fine, anyone else is refused', async () => {
    const bizId = await newBusiness()
    const { code } = await invite(bizId, 'owner')
    await call(ws.acceptInvite, 'ana', { code })
    assert.equal((await call(ws.acceptInvite, 'ana', { code })).alreadyMember, true)
    await rejects(call(ws.acceptInvite, 'eve', { code }), 410, 'invite_used')
    await rejects(call(ws.previewInvite, null, { code }), 410)
  })

  test('two people racing for one code: exactly one gets in', async () => {
    const bizId = await newBusiness()
    const { code } = await invite(bizId, 'owner')
    const results = await Promise.allSettled(['p1', 'p2', 'p3'].map(uid => call(ws.acceptInvite, uid, { code })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    const members = await db.collection(`businesses/${bizId}/members`).where('role', '==', 'employee').get()
    assert.equal(members.size, 1)
  })

  test('expired and revoked invites are refused with a reason', async () => {
    const bizId = await newBusiness()
    const { code } = await invite(bizId, 'owner')
    await rejects(call(ws.acceptInvite, 'ana', { code }, new Date('2026-11-20T00:00:00Z')), 410, 'invite_expired')

    const second = await invite(bizId, 'owner', { name: 'Ben' })
    await call(ws.revokeInvite, 'owner', { bizId, inviteId: second.inviteId })
    await rejects(call(ws.acceptInvite, 'ben', { code: second.code }), 404)
    await rejects(call(ws.revokeInvite, 'owner', { bizId, inviteId: second.inviteId }), 409)
  })

  test('garbage and unknown codes say so', async () => {
    await rejects(call(ws.previewInvite, null, { code: 'nope' }), 400)
    await rejects(call(ws.previewInvite, null, { code: 'ABCDE12345' }), 404)
  })

  test('employees cannot invite; managers cannot invite managers', async () => {
    const bizId = await newBusiness()
    await call(ws.acceptInvite, 'mgr', { code: (await invite(bizId, 'owner', { name: 'Mo', role: 'manager' })).code })
    await call(ws.acceptInvite, 'ana', { code: (await invite(bizId, 'owner')).code })
    await rejects(invite(bizId, 'ana', { name: 'X' }), 403)
    await rejects(invite(bizId, 'mgr', { name: 'X', role: 'manager' }), 403)
    await invite(bizId, 'mgr', { name: 'Y' })
    await rejects(invite(bizId, 'stranger', { name: 'Z' }), 404)
  })

  test('re-inviting a roster entry that already has an account is refused', async () => {
    const bizId = await newBusiness()
    const { code, staffId } = await invite(bizId, 'owner')
    await call(ws.acceptInvite, 'ana', { code })
    await rejects(invite(bizId, 'owner', { staffId }), 409, 'already_linked')
  })

  test('a member cannot join the same workspace twice through a second invite', async () => {
    const bizId = await newBusiness()
    await call(ws.acceptInvite, 'ana', { code: (await invite(bizId, 'owner')).code })
    await rejects(call(ws.acceptInvite, 'ana', { code: (await invite(bizId, 'owner', { name: 'Ana 2' })).code }), 409, 'already_member')
  })
})

describe('roles, removal and leaving', () => {
  async function team() {
    const bizId = await newBusiness()
    await call(ws.acceptInvite, 'mgr', { code: (await invite(bizId, 'owner', { name: 'Mo', role: 'manager' })).code })
    await call(ws.acceptInvite, 'ana', { code: (await invite(bizId, 'owner')).code })
    return bizId
  }

  test('owners change roles and the mirror follows; nobody else can', async () => {
    const bizId = await team()
    await rejects(call(ws.updateMemberRole, 'mgr', { bizId, memberUid: 'ana', role: 'manager' }), 403)
    await call(ws.updateMemberRole, 'owner', { bizId, memberUid: 'ana', role: 'manager' })
    assert.equal((await db.doc(paths.workplace('ana', bizId)).get()).data().role, 'manager')
  })

  test('the last owner is protected until there is another', async () => {
    const bizId = await team()
    await rejects(call(ws.updateMemberRole, 'owner', { bizId, memberUid: 'owner', role: 'manager' }), 403)
    await rejects(call(ws.leaveBusiness, 'owner', { bizId }), 403)
    await call(ws.updateMemberRole, 'owner', { bizId, memberUid: 'mgr', role: 'owner' })
    await call(ws.leaveBusiness, 'owner', { bizId })
  })

  test('removal ends access but keeps the roster entry for history', async () => {
    const bizId = await team()
    const staffId = (await db.doc(paths.member(bizId, 'ana')).get()).data().staffId
    await call(ws.removeMember, 'mgr', { bizId, memberUid: 'ana' })
    assert.equal((await db.doc(paths.member(bizId, 'ana')).get()).data().status, 'removed')
    const staff = (await db.doc(paths.staff(bizId, staffId)).get()).data()
    assert.equal(staff.name, 'Ana')
    assert.equal(staff.uid, undefined)
    assert.equal((await db.doc(paths.workplace('ana', bizId)).get()).exists, false)
    await rejects(call(ws.removeMember, 'mgr', { bizId, memberUid: 'owner' }), 403)
    // A removed person can be invited back.
    await call(ws.acceptInvite, 'ana', { code: (await invite(bizId, 'owner', { staffId })).code })
  })

  test('account deletion leaves every workspace, and refuses while the sole owner of a team', async () => {
    const shared = await team()
    const solo = await newBusiness('ana')
    assert.deepEqual(await ws.leaveAllForDeletion({ db, uid: 'owner', now }), { ok: false, blocking: ['Blue Door'] })
    assert.equal((await db.doc(paths.member(shared, 'owner')).get()).data().status, 'active')

    assert.equal((await ws.leaveAllForDeletion({ db, uid: 'ana', now })).ok, true)
    assert.equal((await db.doc(paths.member(shared, 'ana')).get()).data().status, 'removed')
    assert.equal((await db.doc(paths.business(solo)).get()).exists, false)
    assert.equal((await db.collection(`businesses/${solo}/members`).get()).size, 0)
  })
})
