import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { backoffMs, drainEmailOutbox, MAX_ATTEMPTS, persistNotifications, pruneExpired, sendEssentialEmail, sha } from '../../api/_notify.js'
import { deliver } from '../../api/_teams-notify.js'
import { applyEvent, verifySvix } from '../../api/email/webhook.js'
import { reportEvent } from '../../api/_teams-email.js'
import { createHmac } from 'node:crypto'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'
import { FEATURES } from '../../shared/features.js'

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

const ON = { RESEND_API_KEY: 'test', APP_ORIGIN: 'https://hengam.app', TEAMS_APP_ORIGIN: 'https://teams.hengam.app' }
const now = new Date('2026-11-12T18:00:00Z')
const addresses = { ana: 'ana@example.com', ben: 'ben@example.com', mgr: 'mgr@example.com' }
const address = async (uid) => addresses[uid] || null
const outbox = () => { const sent = []; return { sent, send: async (m) => { sent.push(m); return { id: `re_${sent.length}` } } } }
const entry = (uid, key, type = 'invite_accepted', extra = {}) => ({ uid, key, type, app: 'web', link: '/employees', title: 'Ana joined your team', body: 'b', facts: { who: 'Ana' }, ...extra })
const docs = async (path) => (await db.collection(path).get()).docs.map(d => ({ id: d.id, ...d.data() }))

test('one event, delivered twice, is one notification and one email', async () => {
  const { sent, send } = outbox()
  for (let i = 0; i < 2; i++) {
    const r = await persistNotifications(db, [entry('mgr', 'web_inv_1')], now)
    await drainEmailOutbox(db, { ids: r.emails, now, env: ON, send, address })
  }
  assert.equal((await docs('users/mgr/notifications')).length, 1)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'mgr@example.com')
  assert.match(sent[0].html, /https:\/\/hengam\.app\/employees/)
  const row = (await docs('emailOutbox'))[0]
  assert.equal(row.status, 'sent')
  assert.equal(row.title, null, 'content is cleared once sent')
  const log = await docs('emailLog')
  assert.equal(log.length, 1)
  assert.equal(JSON.stringify(log).includes('mgr@example.com'), false, 'the log holds no address')
})

test('preferences: email off keeps the in-app notification; in-app off keeps the email', async () => {
  await db.doc('users/mgr').set({ notificationPrefs: { email: { team: false } } })
  await db.doc('users/ben').set({ notificationPrefs: { inApp: { team: false } } })
  const r = await persistNotifications(db, [entry('mgr', 'k1'), entry('ben', 'k1')], now)
  assert.deepEqual(r.emails, ['ben_k1'])
  assert.equal((await docs('users/mgr/notifications')).length, 1)
  assert.equal((await docs('users/ben/notifications')).length, 0)
})

test('essential security emails ignore preferences, come from security@, never become in-app items', async () => {
  await db.doc('users/ana').set({ notificationPrefs: { email: { schedule: false, team: false, billing: false, product: false, reminders: false, requests: false } } })
  const { sent, send } = outbox()
  const r = await sendEssentialEmail(db, { to: 'ana@example.com', type: 'password_changed', now, env: ON, send })
  assert.equal(r.sent, true)
  assert.equal(sent[0].from, 'HENGAM Security <security@mail.hengam.app>')
  assert.match(sent[0].subject, /password was changed/)
  assert.match(sent[0].html, /forgot-password/)
  assert.equal((await docs('users/ana/notifications')).length, 0)
})

test('a failing provider is retried with backoff, then given up and reported', async () => {
  const r = await persistNotifications(db, [entry('mgr', 'k2')], now)
  const send = async () => { throw new Error('email provider answered 503') }
  let at = now
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await drainEmailOutbox(db, { ids: attempt === 1 ? r.emails : null, now: at, env: ON, send, address })
    const row = (await db.doc('emailOutbox/mgr_k2').get()).data()
    if (attempt < MAX_ATTEMPTS) {
      assert.equal(row.status, 'retry')
      assert.equal(row.nextAttemptAt.toMillis(), +at + backoffMs(attempt))
      // Not due yet: nothing happens.
      await drainEmailOutbox(db, { now: new Date(+at + 1000), env: ON, send, address })
      assert.equal((await db.doc('emailOutbox/mgr_k2').get()).data().attempts, attempt)
      at = new Date(row.nextAttemptAt.toMillis())
    } else {
      assert.equal(row.status, 'failed')
    }
  }
  const errors = await docs('errorEvents')
  assert.ok(errors.some(e => e.where === 'email.send'))
})

test('suppressed (bounced) and unverified addresses are never mailed', async () => {
  await db.doc(`emailSuppressions/${sha('mgr@example.com')}`).set({ reason: 'bounced' })
  const { sent, send } = outbox()
  const r = await persistNotifications(db, [entry('mgr', 'k3'), entry('nobody', 'k3')], now)
  await drainEmailOutbox(db, { ids: r.emails, now, env: ON, send, address })
  assert.equal(sent.length, 0)
  const rows = await docs('emailOutbox')
  assert.deepEqual(rows.map(x => x.reason).sort(), ['no_verified_address', 'suppressed'])
})

test('with email off, nothing is sent and nothing is lost', async () => {
  const { sent, send } = outbox()
  const r = await persistNotifications(db, [entry('mgr', 'k4')], now)
  assert.deepEqual(await drainEmailOutbox(db, { ids: r.emails, now, env: {}, send, address }), { sent: 0, failed: 0, skipped: 'disabled' })
  assert.equal(sent.length, 0)
  assert.equal((await db.doc('emailOutbox/mgr_k4').get()).data().status, 'pending')
})

test('Persian readers get Persian email with right-to-left layout (English while Persian is switched off)', async () => {
  await db.doc('users/mgr').set({ notificationPrefs: { language: 'fa' } })
  const { sent, send } = outbox()
  const r = await persistNotifications(db, [entry('mgr', 'k5')], now)
  await drainEmailOutbox(db, { ids: r.emails, now, env: ON, send, address })
  if (FEATURES.persian) {
    assert.match(sent[0].html, /dir="rtl"/)
    assert.match(sent[0].subject, /به تیم پیوست/)
  } else {
    assert.match(sent[0].html, /dir="ltr"/)
    assert.doesNotMatch(sent[0].subject + sent[0].text, /[\u0600-\u06FF]/)
    assert.equal((await db.doc('users/mgr').get()).data().notificationPrefs.language, 'fa', 'the saved preference is kept')
  }
})

test('Teams workflow events reach email with safe facts and a Teams link', async () => {
  const call = (fn, uid, input) => fn({ db, uid, token: { uid, email: `${uid}@x.test`, email_verified: true }, input, now })
  const { bizId } = await call(ws.createBusiness, 'owner', { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: 'req-notify-email-1' })
  const inv = await call(ws.createInvite, 'owner', { bizId, name: 'Ana', role: 'employee' })
  await call(ws.acceptInvite, 'ana', { code: inv.code })
  const shift = await call(sched.saveShift, 'owner', { bizId, staffId: inv.staffId, date: '2026-11-16', start: '09:00', end: '13:00' })
  const pub = await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-11-16' })
  const r = await deliver(db, pub.notify || [], now)
  assert.ok(shift)
  const note = (await docs('users/ana/notifications')).find(n => n.type === 'schedule_published')
  assert.ok(note, 'Ana has the in-app notification')
  assert.deepEqual(note.facts, { biz: 'Blue Door', weekStart: '2026-11-16', count: 1 })
  const { sent, send } = outbox()
  await drainEmailOutbox(db, { ids: r.emails, now, env: ON, send, address })
  const mail = sent.find(m => m.to === 'ana@example.com')
  assert.ok(mail)
  assert.match(mail.html, /https:\/\/teams\.hengam\.app\/calendar/)
})

test('webhook: only correctly signed, fresh events are accepted', () => {
  const secret = `whsec_${Buffer.from('k'.repeat(24)).toString('base64')}`
  const body = '{"type":"email.delivered"}'
  const ts = String(Math.floor(+now / 1000))
  const sig = createHmac('sha256', Buffer.from('k'.repeat(24))).update(`msg_1.${ts}.${body}`).digest('base64')
  assert.equal(verifySvix({ secret, id: 'msg_1', timestamp: ts, signature: `v1,${sig}`, body, now: +now }), true)
  assert.equal(verifySvix({ secret, id: 'msg_1', timestamp: ts, signature: `v1,${sig}`, body: body + ' ', now: +now }), false)
  assert.equal(verifySvix({ secret, id: 'msg_2', timestamp: ts, signature: `v1,${sig}`, body, now: +now }), false)
  assert.equal(verifySvix({ secret, id: 'msg_1', timestamp: ts, signature: `v1,${sig}`, body, now: +now + 10 * 60_000 }), false)
  assert.equal(verifySvix({ secret: '', id: 'msg_1', timestamp: ts, signature: `v1,${sig}`, body, now: +now }), false)
})

test('webhook: hard bounces and complaints suppress the address; soft bounces do not', async () => {
  await applyEvent(db, { type: 'email.bounced', data: { email_id: 'e1', to: ['hard@example.com'], bounce: { type: 'Permanent' } } }, now)
  await applyEvent(db, { type: 'email.bounced', data: { email_id: 'e2', to: ['soft@example.com'], bounce: { type: 'Transient' } } }, now)
  await applyEvent(db, { type: 'email.complained', data: { email_id: 'e3', to: ['spam@example.com'] } }, now)
  await applyEvent(db, { type: 'email.delivered', data: { email_id: 'e3', to: ['spam@example.com'] } }, now)
  const sup = (await docs('emailSuppressions')).map(d => d.id).sort()
  assert.deepEqual(sup, [sha('hard@example.com'), sha('spam@example.com')].sort())
  assert.equal((await docs('emailEvents')).length, 4)
  // The same event twice is one row.
  await applyEvent(db, { type: 'email.delivered', data: { email_id: 'e3' } }, now)
  assert.equal((await docs('emailEvents')).length, 4)
})

test('web events are checked against stored records before anyone is told', async () => {
  const delivered = []
  const deliverWeb = async (entries) => { delivered.push(...entries); return { emails: [] } }
  await db.doc('invites/inv1').set({ managerId: 'mgr', employeeName: 'Ana', used: true, usedBy: 'ana' })
  await assert.rejects(reportEvent({ db, uid: 'intruder', input: { type: 'invite_accepted', inviteId: 'inv1' }, now, deliverWeb }), /not accepted by you/)
  await reportEvent({ db, uid: 'ana', input: { type: 'invite_accepted', inviteId: 'inv1' }, now, deliverWeb })
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].uid, 'mgr')

  // Availability: only a linked employee, only right after a real save, grouped hourly.
  await db.doc('employees/e1').set({ userId: 'mgr', name: 'Ana' })
  await db.doc('users/ana').set({ accountType: 'employee', managerId: 'mgr', linkedEmployeeId: 'e1', availabilityUpdatedAt: Timestamp.fromDate(new Date(+now - 60_000)) })
  await db.doc('users/eve').set({ accountType: 'employee', managerId: 'other', linkedEmployeeId: 'e1', availabilityUpdatedAt: Timestamp.fromDate(now) })
  await assert.rejects(reportEvent({ db, uid: 'eve', input: { type: 'availability_changed' }, now, deliverWeb }), /not on your manager/)
  await reportEvent({ db, uid: 'ana', input: { type: 'availability_changed' }, now, deliverWeb })
  assert.equal(delivered.length, 2)
  assert.equal(delivered[1].uid, 'mgr')
  assert.match(delivered[1].key, /^web_avail_e1_\d+$/)
  await db.doc('users/ana').update({ availabilityUpdatedAt: Timestamp.fromDate(new Date(+now - 60 * 60_000)) })
  assert.deepEqual(await reportEvent({ db, uid: 'ana', input: { type: 'availability_changed' }, now, deliverWeb }), { ok: true, sent: false })
  await assert.rejects(reportEvent({ db, uid: 'ana', input: { type: 'made_up' }, now, deliverWeb }), /Unknown event/)
})

test('retention: expired outbox and log rows are pruned', async () => {
  await db.doc('emailOutbox/old').set({ status: 'sent', expireAt: Timestamp.fromDate(new Date(+now - 1)) })
  await db.doc('emailOutbox/new').set({ status: 'sent', expireAt: Timestamp.fromDate(new Date(+now + 1000)) })
  await db.doc('emailLog/old').set({ status: 'sent', expireAt: Timestamp.fromDate(new Date(+now - 1)) })
  assert.equal(await pruneExpired(db, now), 2)
  assert.deepEqual((await docs('emailOutbox')).map(d => d.id), ['new'])
})

test('a send refused before the provider (allowlist) is recorded as dropped, never as sent', async () => {
  const send = async () => ({ sent: false, reason: 'not_allowed' })
  const r = await persistNotifications(db, [entry('mgr', 'k9')], now)
  const out = await drainEmailOutbox(db, { ids: r.emails, now, env: ON, send, address })
  assert.equal(out.sent, 0)
  const row = (await db.doc('emailOutbox/mgr_k9').get()).data()
  assert.equal(row.status, 'dropped')
  assert.equal(row.reason, 'not_allowed')
  const ess = await sendEssentialEmail(db, { to: 'x@example.com', type: 'password_changed', now, env: ON, send })
  assert.deepEqual(ess, { sent: false, reason: 'not_allowed' })
  assert.ok((await docs('emailLog')).some(l => l.status === 'dropped' && l.reason === 'not_allowed'))
})
