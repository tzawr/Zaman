import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { fingerprintOf, recordError, reportClientError, summariseAndPruneErrors } from '../../api/_monitoring.js'
import { deleteAccount } from '../../api/_account-deletion.js'
import { runDailyJob } from '../../api/_teams-jobs.js'
import * as ws from '../../api/_teams-workspaces.js'

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

const now = new Date('2026-10-21T12:00:00Z')
const events = async () => (await db.collection('errorEvents').get()).docs.map(d => d.data())

describe('error monitoring', () => {
  test('the same failure with different ids is one group with a count', async () => {
    const boom = (id) => Object.assign(new Error(`Shift abc${id}def0123 not found after 3 tries`), { stack: `Error\n    at saveShift (/var/task/api/_teams-schedules.js:${id}:9)` })
    assert.equal(
      fingerprintOf({ source: 'server', where: 'saveShift', message: boom(1).message, stack: boom(1).stack }),
      fingerprintOf({ source: 'server', where: 'saveShift', message: boom(2).message, stack: boom(2).stack }))

    await recordError(db, { source: 'server', where: 'saveShift', error: boom(11), uid: 'u1', now })
    await recordError(db, { source: 'server', where: 'saveShift', error: boom(12), uid: 'u2', now })
    await recordError(db, { source: 'server', where: 'saveShift', error: boom(13), uid: 'u1', now })
    await recordError(db, { source: 'server', where: 'publishSchedule', error: new Error('other'), now })
    const all = await events()
    assert.equal(all.length, 2)
    const grouped = all.find(e => e.where === 'saveShift')
    assert.equal(grouped.count, 3)
    assert.deepEqual(grouped.uids.sort(), ['u1', 'u2'])
    assert.equal(grouped.day, '2026-10-21')
  })

  test('recording never throws, even when Firestore refuses', async () => {
    const broken = { collection: () => { throw new Error('no firestore') } }
    assert.equal(await recordError(broken, { source: 'server', where: 'x', error: new Error('y'), now }), null)
  })

  test('app reports are bounded text', async () => {
    await reportClientError({ db, uid: null, now, input: {
      message: 'x'.repeat(5000), stack: { not: 'text' }, route: '(app)/calendar', platform: 'ios', appVersion: '1.0.0', extra: 'ignored',
    } })
    const [e] = await events()
    assert.equal(e.source, 'app')
    assert.equal(e.where, '(app)/calendar')
    assert.equal(e.message.length, 500)
    assert.equal(e.stack, '')
    assert.deepEqual(e.uids, [])
    assert.equal(e.context.platform, 'ios')
    assert.equal(e.context.extra, undefined)
  })

  test('the daily job prunes old errors and keeps going when a part fails', async () => {
    const old = new Date('2026-09-01T00:00:00Z')
    await recordError(db, { source: 'server', where: 'old', error: new Error('old'), now: old })
    await recordError(db, { source: 'server', where: 'new', error: new Error('new'), now })
    assert.deepEqual(await summariseAndPruneErrors(db, now), { errorGroups: 1, errorCount: 1, errorsPruned: 1 })

    // Reminders fail (as with a missing index); expiry, push and the error
    // summary still run, and the failure is recorded.
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === 'collectionGroup') {
          return (group) => {
            if (group === 'shifts') throw new Error('The query requires an index')
            return target.collectionGroup(group)
          }
        }
        const value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await runDailyJob(flaky, now)
    assert.deepEqual(result.failed, ['reminders'])
    assert.equal(result.offersExpired, 0)
    assert.equal(result.sent, 0)
    // Today's earlier error, and the reminders failure just recorded.
    assert.equal(result.errorGroups, 2)
    assert.ok((await events()).some(e => e.source === 'cron' && e.where === 'reminders'))
  })
})

describe('deleting an account', () => {
  const token = (uid, ageSeconds = 30) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid, auth_time: Math.floor(now.getTime() / 1000) - ageSeconds })
  const fakeAuth = () => { const deleted = []; return { deleted, deleteUser: async (uid) => { deleted.push(uid) } } }

  test('needs a recent sign-in', async () => {
    const auth = fakeAuth()
    await assert.rejects(deleteAccount({ db, uid: 'u1', token: token('u1', 600), now, auth }),
      (err) => err.status === 401 && err.reason === 'reauth_required')
    assert.deepEqual(auth.deleted, [])
  })

  test('refuses while the only owner of a workplace with other people', async () => {
    const { bizId } = await ws.createBusiness({ db, uid: 'owner', token: token('owner'), input: { name: 'Blue Door', timezone: 'UTC', requestId: 'req-del-1' }, now })
    const { code } = await ws.createInvite({ db, uid: 'owner', token: token('owner'), input: { bizId, name: 'Ana' }, now })
    await ws.acceptInvite({ db, uid: 'ana', token: token('ana'), input: { code }, now })
    const auth = fakeAuth()
    await assert.rejects(deleteAccount({ db, uid: 'owner', token: token('owner'), now, auth }),
      (err) => err.status === 409 && err.reason === 'sole_owner' && err.message.includes('Blue Door'))
    assert.deepEqual(auth.deleted, [])
    assert.ok((await db.doc(`users/owner/workplaces/${bizId}`).get()).exists)

    // Ana can go: she leaves the workplace and her data is erased.
    await db.doc('users/ana/notifications/n1').set({ title: 'hi' })
    await db.doc('calendarFeeds/feed1').set({ uid: 'ana' })
    assert.deepEqual(await deleteAccount({ db, uid: 'ana', token: token('ana'), now, auth }), { ok: true })
    assert.deepEqual(auth.deleted, ['ana'])
    assert.equal((await db.doc(`businesses/${bizId}/members/ana`).get()).data().status, 'removed')
    assert.equal((await db.doc('users/ana/notifications/n1').get()).exists, false)
    assert.equal((await db.doc('calendarFeeds/feed1').get()).exists, false)
  })

  test('a failure part-way is recorded and leaves the sign-in in place', async () => {
    const auth = { deleteUser: async () => { throw new Error('auth is down') } }
    await assert.rejects(deleteAccount({ db, uid: 'u2', token: token('u2'), now, auth }),
      (err) => err.status === 500 && err.reason === 'server_error')
    const [e] = await events()
    assert.equal(e.where, 'deleteAccount')
    assert.deepEqual(e.uids, ['u2'])
  })
})
