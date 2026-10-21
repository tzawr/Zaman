import { after, before, beforeEach, describe, test } from 'node:test'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { createEnv, seed } from './helpers.js'

// The existing Hengam rules, covering the three holes closed alongside the
// Teams work: reusable invites, employee availability the manager could not
// read, and employees reading the whole team's schedule.

let env
before(async () => { env = await createEnv() })
after(async () => { await env.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await seed(env, {
    'users/mgr': { email: 'm@x.test', allowEmployeeFullView: false },
    'users/otherMgr': { email: 'o@x.test' },
    'employees/emp1': { userId: 'mgr', name: 'Ana' },
    'invites/tok1': { managerId: 'mgr', employeeId: 'emp1', employeeName: 'Ana', used: false },
    'schedules/s1': { userId: 'mgr', weekStart: '2026-10-19', data: { days: {} } },
  })
})

function linkBatch(db, uid, token = 'tok1', { claim = true, employeeId = 'emp1' } = {}) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid), {
    email: `${uid}@x.test`,
    accountType: 'employee',
    managerId: 'mgr',
    linkedEmployeeId: employeeId,
    inviteToken: token,
  }, { merge: true })
  if (claim) batch.update(doc(db, 'invites', token), { used: true, usedBy: uid, usedAt: serverTimestamp() })
  return batch
}

describe('invites are single-use', () => {
  test('accepting links the account and closes the invite in one batch', async () => {
    const db = env.authenticatedContext('ana').firestore()
    await assertSucceeds(linkBatch(db, 'ana').commit())
  })

  test('a second account cannot use the same invite', async () => {
    await assertSucceeds(linkBatch(env.authenticatedContext('ana').firestore(), 'ana').commit())
    const eve = env.authenticatedContext('eve').firestore()
    await assertFails(linkBatch(eve, 'eve').commit())
    await assertFails(linkBatch(eve, 'eve', 'tok1', { claim: false }).commit())
  })

  test('linking without closing the invite is refused', async () => {
    const db = env.authenticatedContext('ana').firestore()
    await assertFails(linkBatch(db, 'ana', 'tok1', { claim: false }).commit())
  })

  test('linking to an employee the invite does not name is refused', async () => {
    const db = env.authenticatedContext('ana').firestore()
    await assertFails(linkBatch(db, 'ana', 'tok1', { employeeId: 'someoneElse' }).commit())
  })

  test('an invite cannot be closed on its own, or in someone else\'s name', async () => {
    const db = env.authenticatedContext('eve').firestore()
    await assertFails(updateDoc(doc(db, 'invites', 'tok1'), { used: true, usedBy: 'eve', usedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'invites', 'tok1'), { used: true, usedBy: 'ana', usedAt: serverTimestamp() }))
  })

  test('the manager can still revoke an invite', async () => {
    const db = env.authenticatedContext('mgr').firestore()
    await assertSucceeds(updateDoc(doc(db, 'invites', 'tok1'), { used: true }))
  })
})

describe('managers can read their employees\' submissions', () => {
  beforeEach(async () => {
    await seed(env, {
      'users/ana': { accountType: 'employee', managerId: 'mgr', linkedEmployeeId: 'emp1', availability: { monday: {} } },
      'users/zed': { accountType: 'employee', managerId: 'otherMgr', linkedEmployeeId: 'emp9' },
    })
  })

  test('the manager reads a linked employee\'s portal record, by query and directly', async () => {
    const db = env.authenticatedContext('mgr').firestore()
    await assertSucceeds(getDoc(doc(db, 'users', 'ana')))
    await assertSucceeds(getDocs(query(collection(db, 'users'),
      where('managerId', '==', 'mgr'), where('accountType', '==', 'employee'))))
  })

  test('another manager\'s employees stay private', async () => {
    const db = env.authenticatedContext('mgr').firestore()
    await assertFails(getDoc(doc(db, 'users', 'zed')))
    await assertFails(getDoc(doc(db, 'users', 'otherMgr')))
  })

  test('an employee cannot read their manager or a coworker', async () => {
    await seed(env, { 'users/ben': { accountType: 'employee', managerId: 'mgr', linkedEmployeeId: 'emp2' } })
    const db = env.authenticatedContext('ana').firestore()
    await assertFails(getDoc(doc(db, 'users', 'mgr')))
    await assertFails(getDoc(doc(db, 'users', 'ben')))
  })

  test('the manager still cannot write an employee\'s record', async () => {
    const db = env.authenticatedContext('mgr').firestore()
    await assertFails(updateDoc(doc(db, 'users', 'ana'), { availability: {} }))
  })
})

describe('schedules', () => {
  test('a linked employee no longer reads the team schedule directly', async () => {
    await seed(env, { 'users/ana': { accountType: 'employee', managerId: 'mgr', linkedEmployeeId: 'emp1' } })
    const db = env.authenticatedContext('ana').firestore()
    await assertFails(getDoc(doc(db, 'schedules', 's1')))
  })

  test('the manager reads and writes their own', async () => {
    const db = env.authenticatedContext('mgr').firestore()
    await assertSucceeds(getDoc(doc(db, 'schedules', 's1')))
    await assertSucceeds(updateDoc(doc(db, 'schedules', 's1'), { weekStart: '2026-10-26' }))
  })

  test('billing fields are still not self-writable', async () => {
    const db = env.authenticatedContext('mgr').firestore()
    await assertFails(setDoc(doc(db, 'users', 'mgr'), { tier: 'pro' }, { merge: true }))
  })
})
