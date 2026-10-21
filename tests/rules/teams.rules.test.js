import { after, before, beforeEach, describe, test } from 'node:test'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { paths } from '../../shared/teams/schema.js'
import { createEnv, seed } from './helpers.js'

// Two businesses, A and B. Ana and Ben work at A; Ben also works at B, where
// Carl manages. Gus used to work at A. Olly is signed in but belongs nowhere.

let env
before(async () => { env = await createEnv() })
after(async () => { await env.cleanup() })

const shift = (uid, published = true) => ({
  assigneeUid: uid, staffId: `staff-${uid}`, published, status: 'scheduled',
  startAt: new Date('2026-10-20T15:00:00Z'), endAt: new Date('2026-10-20T23:00:00Z'),
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed(env, {
    [paths.business('A')]: { name: 'Cafe A', mode: 'standalone' },
    [paths.member('A', 'owner')]: { role: 'owner', status: 'active', staffId: 'staff-owner' },
    [paths.member('A', 'ana')]: { role: 'employee', status: 'active', staffId: 'staff-ana' },
    [paths.member('A', 'ben')]: { role: 'employee', status: 'active', staffId: 'staff-ben' },
    [paths.member('A', 'gus')]: { role: 'employee', status: 'removed', staffId: 'staff-gus' },
    [paths.policies('A')]: { employeeFullView: false },
    [paths.staff('A', 'staff-ana')]: { name: 'Ana', uid: 'ana' },
    [paths.staffPrivate('A', 'staff-ana')]: { uid: 'ana', phone: '555' },
    [paths.staffPrivate('A', 'staff-ben')]: { uid: 'ben', phone: '777' },
    [paths.position('A', 'barista')]: { name: 'Barista' },
    [paths.schedule('A', 'pub')]: { status: 'published' },
    [paths.schedule('A', 'draft')]: { status: 'draft' },
    [paths.shift('A', 'ana1')]: shift('ana'),
    [paths.shift('A', 'ana-draft')]: shift('ana', false),
    [paths.shift('A', 'ben1')]: shift('ben'),
    [paths.offer('A', 'o1')]: { shiftId: 'ben1', offeredByUid: 'ben', status: 'available' },
    [paths.claim('A', 'o1', 'ana')]: { status: 'pending' },
    [paths.swap('A', 'sw1')]: { requesterUid: 'ana', counterpartyUid: 'ben', status: 'pending_peer' },
    [paths.availability('A', 'staff-ana')]: { uid: 'ana', weekly: {} },
    [paths.availabilityOverride('A', 'staff-ana', 'ov1')]: { uid: 'ana' },
    [paths.availability('A', 'staff-ben')]: { uid: 'ben', weekly: {} },
    [paths.timeOff('A', 't-ana')]: { uid: 'ana', status: 'pending' },
    [paths.timeOff('A', 't-ben')]: { uid: 'ben', status: 'pending' },
    [paths.importJob('A', 'i1')]: { status: 'review' },
    [paths.audit('A', 'a1')]: { action: 'publish' },
    [paths.syncState('A', 'hengam')]: { status: 'ok' },

    [paths.business('B')]: { name: 'Bistro B', mode: 'hengam' },
    [paths.member('B', 'carl')]: { role: 'manager', status: 'active', staffId: 'staff-carl' },
    [paths.member('B', 'ben')]: { role: 'employee', status: 'active', staffId: 'staff-ben-b' },
    [paths.shift('B', 'ben-b')]: shift('ben'),

    [paths.workplace('ana', 'A')]: { name: 'Cafe A', role: 'employee' },
    [paths.notification('ana', 'n1')]: { type: 'schedule_published', createdAt: new Date() },
    'userBusy/ana/blocks/x': { startAt: new Date(), endAt: new Date() },
    'calendarFeeds/secret': { uid: 'ana' },
  })
})

const as = (uid) => env.authenticatedContext(uid).firestore()
const get = (uid, path) => getDoc(doc(as(uid), path))

describe('tenant isolation', () => {
  test('members read their business; outsiders, former staff and other managers do not', async () => {
    await assertSucceeds(get('ana', paths.business('A')))
    await assertFails(get('olly', paths.business('A')))
    await assertFails(get('gus', paths.business('A')))
    await assertFails(get('carl', paths.business('A')))
    await assertFails(env.unauthenticatedContext().firestore().doc(paths.business('A')).get())
  })

  test('a manager of B sees nothing of A, even a shift of someone who works at both', async () => {
    await assertFails(get('carl', paths.shift('A', 'ben1')))
    await assertFails(get('carl', paths.staff('A', 'staff-ana')))
    await assertFails(get('carl', paths.timeOff('A', 't-ben')))
    await assertFails(getDocs(collection(as('carl'), 'businesses/A/shifts')))
  })

  test('someone in two businesses sees each through its own membership', async () => {
    await assertSucceeds(get('ben', paths.shift('A', 'ben1')))
    await assertSucceeds(get('ben', paths.shift('B', 'ben-b')))
    await assertFails(get('ben', paths.importJob('A', 'i1')))
  })
})

describe('memberships and roster', () => {
  test('employees see their own membership only; managers see all', async () => {
    await assertSucceeds(get('ana', paths.member('A', 'ana')))
    await assertFails(get('ana', paths.member('A', 'ben')))
    await assertSucceeds(get('owner', paths.member('A', 'ben')))
    await assertSucceeds(getDocs(collection(as('owner'), 'businesses/A/members')))
  })

  test('the roster and setup are team-readable; private details are not', async () => {
    await assertSucceeds(get('ben', paths.staff('A', 'staff-ana')))
    await assertSucceeds(get('ben', paths.position('A', 'barista')))
    await assertSucceeds(get('ben', paths.policies('A')))
    await assertSucceeds(get('ana', paths.staffPrivate('A', 'staff-ana')))
    await assertFails(get('ana', paths.staffPrivate('A', 'staff-ben')))
    await assertSucceeds(get('owner', paths.staffPrivate('A', 'staff-ben')))
  })
})

describe('schedules and shifts', () => {
  test('drafts are the manager\'s until published', async () => {
    await assertSucceeds(get('ana', paths.schedule('A', 'pub')))
    await assertFails(get('ana', paths.schedule('A', 'draft')))
    await assertSucceeds(get('owner', paths.schedule('A', 'draft')))
    await assertFails(get('ana', paths.shift('A', 'ana-draft')))
  })

  test('an employee reads their own published shifts and nobody else\'s', async () => {
    await assertSucceeds(get('ana', paths.shift('A', 'ana1')))
    await assertFails(get('ana', paths.shift('A', 'ben1')))
    const shifts = collection(as('ana'), 'businesses/A/shifts')
    await assertSucceeds(getDocs(query(shifts, where('assigneeUid', '==', 'ana'), where('published', '==', true))))
    await assertFails(getDocs(query(shifts, where('published', '==', true))))
  })

  test('the full-view policy opens coworkers\' published shifts, never drafts', async () => {
    await seed(env, { [paths.policies('A')]: { employeeFullView: true } })
    await assertSucceeds(get('ana', paths.shift('A', 'ben1')))
    const shifts = collection(as('ana'), 'businesses/A/shifts')
    await assertSucceeds(getDocs(query(shifts, where('published', '==', true))))
    await assertFails(getDocs(shifts))
  })
})

describe('marketplace and swaps', () => {
  test('the marketplace is open to the business', async () => {
    await assertSucceeds(get('ana', paths.offer('A', 'o1')))
    await assertFails(get('olly', paths.offer('A', 'o1')))
  })

  test('a claim is visible to its claimant, the offerer and managers only', async () => {
    await seed(env, { [paths.member('A', 'dee')]: { role: 'employee', status: 'active' } })
    await assertSucceeds(get('ana', paths.claim('A', 'o1', 'ana')))
    await assertSucceeds(get('ben', paths.claim('A', 'o1', 'ana')))
    await assertSucceeds(get('owner', paths.claim('A', 'o1', 'ana')))
    await assertFails(get('dee', paths.claim('A', 'o1', 'ana')))
  })

  test('a swap is visible to its two parties and managers only', async () => {
    await seed(env, { [paths.member('A', 'dee')]: { role: 'employee', status: 'active' } })
    await assertSucceeds(get('ana', paths.swap('A', 'sw1')))
    await assertSucceeds(get('ben', paths.swap('A', 'sw1')))
    await assertSucceeds(get('owner', paths.swap('A', 'sw1')))
    await assertFails(get('dee', paths.swap('A', 'sw1')))
  })
})

describe('availability, time off and manager-only records', () => {
  test('each person sees their own; managers see everyone\'s', async () => {
    await assertSucceeds(get('ana', paths.availability('A', 'staff-ana')))
    await assertSucceeds(get('ana', paths.availabilityOverride('A', 'staff-ana', 'ov1')))
    await assertFails(get('ana', paths.availability('A', 'staff-ben')))
    await assertSucceeds(get('ana', paths.timeOff('A', 't-ana')))
    await assertFails(get('ana', paths.timeOff('A', 't-ben')))
    await assertSucceeds(get('owner', paths.timeOff('A', 't-ben')))
    const mine = query(collection(as('ana'), 'businesses/A/timeOff'), where('uid', '==', 'ana'))
    await assertSucceeds(getDocs(mine))
    await assertFails(getDocs(collection(as('ana'), 'businesses/A/timeOff')))
  })

  test('imports, the audit log and sync state are for managers', async () => {
    for (const path of [paths.importJob('A', 'i1'), paths.audit('A', 'a1'), paths.syncState('A', 'hengam')]) {
      await assertFails(get('ana', path))
      await assertSucceeds(get('owner', path))
    }
  })
})

describe('clients never write business data', () => {
  test('not even the owner, and not even their own records', async () => {
    const owner = as('owner')
    const ana = as('ana')
    await assertFails(updateDoc(doc(owner, paths.shift('A', 'ana1')), { assigneeUid: 'ben' }))
    await assertFails(updateDoc(doc(ana, paths.shift('A', 'ana1')), { assigneeUid: 'ana', note: 'x' }))
    await assertFails(setDoc(doc(ana, paths.claim('A', 'o1', 'ana')), { status: 'approved' }))
    await assertFails(setDoc(doc(ana, paths.member('A', 'ana')), { role: 'owner', status: 'active' }))
    await assertFails(setDoc(doc(as('olly'), paths.member('A', 'olly')), { role: 'employee', status: 'active' }))
    await assertFails(updateDoc(doc(ana, paths.timeOff('A', 't-ana')), { status: 'approved' }))
    await assertFails(setDoc(doc(ana, paths.availability('A', 'staff-ana')), { uid: 'ana', weekly: {} }))
    await assertFails(setDoc(doc(owner, paths.policies('A')), { employeeFullView: true }))
    await assertFails(deleteDoc(doc(owner, paths.audit('A', 'a1'))))
    await assertFails(setDoc(doc(owner, paths.business('C')), { name: 'New' }))
  })
})

describe('the user\'s own corner', () => {
  test('workplaces are readable by their owner and written by the server', async () => {
    await assertSucceeds(get('ana', paths.workplace('ana', 'A')))
    await assertFails(get('ben', paths.workplace('ana', 'A')))
    await assertFails(setDoc(doc(as('ana'), paths.workplace('ana', 'B')), { name: 'Bistro B' }))
  })

  test('a notification can be marked read and cleared, nothing more', async () => {
    const ana = as('ana')
    const ref = doc(ana, paths.notification('ana', 'n1'))
    await assertSucceeds(updateDoc(ref, { readAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { type: 'swap_decided' }))
    await assertFails(updateDoc(ref, { readAt: new Date('2020-01-01') }))
    await assertFails(setDoc(doc(ana, paths.notification('ana', 'forged')), { type: 'pickup_decided' }))
    await assertFails(get('ben', paths.notification('ana', 'n1')))
    await assertSucceeds(deleteDoc(ref))
  })

  test('devices register with a known shape only', async () => {
    const ana = as('ana')
    const ok = { platform: 'ios', token: 'abc', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
    await assertSucceeds(setDoc(doc(ana, paths.device('ana', 'd1')), ok))
    await assertFails(setDoc(doc(ana, paths.device('ana', 'd2')), { ...ok, platform: 'fax' }))
    await assertFails(setDoc(doc(ana, paths.device('ana', 'd3')), { ...ok, extra: true }))
    await assertFails(setDoc(doc(as('ben'), paths.device('ana', 'd4')), ok))
  })

  test('cross-workplace busy blocks and calendar tokens are server-only', async () => {
    await assertFails(get('ana', 'userBusy/ana/blocks/x'))
    await assertFails(get('ana', 'calendarFeeds/secret'))
  })
})
