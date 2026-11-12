import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { emailInvite, sendWelcome } from '../../api/_teams-email.js'
import { escapeHtml, inviteEmail, sendEmail, validEmail } from '../../api/_email.js'

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

const ON = { RESEND_API_KEY: 'test-key', APP_ORIGIN: 'https://hengam.app' }
const now = new Date('2026-11-12T18:00:00Z')
const outbox = () => { const sent = []; const send = async (msg, { env }) => { sent.push({ ...msg, env }); return { sent: true } }; return { sent, send } }
async function invite(id, data = {}) {
  await db.doc('users/mgr').set({ businessName: 'Blue <Door> Café', onboarded: true })
  await db.doc(`invites/${id}`).set({ managerId: 'mgr', employeeName: 'Ana', used: false, ...data })
}

test('a manager emails their own unused invite; the link uses APP_ORIGIN and names are escaped', async () => {
  await invite('inv-1')
  const { sent, send } = outbox()
  const r = await emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-1', email: ' ana@example.com ' }, now, env: ON, send })
  assert.deepEqual(r, { sent: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'ana@example.com')
  assert.match(sent[0].text, /https:\/\/hengam\.app\/invite\/inv-1/)
  assert.match(sent[0].html, /Blue &lt;Door&gt; Café/)
  assert.doesNotMatch(sent[0].html, /<Door>/)
  assert.ok((await db.doc('invites/inv-1').get()).data().emailedAt)
})

test('nobody else can email an invite, nor a used one, nor twice within 10 minutes', async () => {
  await invite('inv-2')
  const { sent, send } = outbox()
  await assert.rejects(emailInvite({ db, uid: 'intruder', input: { inviteId: 'inv-2', email: 'a@example.com' }, now, env: ON, send }), /Only the manager/)
  await invite('inv-3', { used: true })
  await assert.rejects(emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-3', email: 'a@example.com' }, now, env: ON, send }), /already been used/)
  await emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-2', email: 'a@example.com' }, now, env: ON, send })
  await assert.rejects(emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-2', email: 'a@example.com' }, now: new Date(+now + 60_000), env: ON, send }), /just emailed/)
  await emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-2', email: 'a@example.com' }, now: new Date(+now + 11 * 60_000), env: ON, send })
  assert.equal(sent.length, 2)
})

test('bad addresses and header tricks are refused; with no key nothing is sent', async () => {
  await invite('inv-4')
  const { sent, send } = outbox()
  for (const email of ['nope', 'a@b', 'a@example.com\nBcc: x@evil.test', 'a@example.com, b@example.com', '"x"@example.com'])
    await assert.rejects(emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-4', email }, now, env: ON, send }), /does not look right/, email)
  await assert.rejects(emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-4', email: 'a@example.com' }, now, env: {}, send }), /not set up/)
  assert.equal(sent.length, 0)
  assert.equal((await db.doc('invites/inv-4').get()).data().emailedAt, undefined)
})

test('a failed send gives the invite slot back', async () => {
  await invite('inv-5')
  const send = async () => { throw new Error('email provider answered 500') }
  await assert.rejects(emailInvite({ db, uid: 'mgr', input: { inviteId: 'inv-5', email: 'a@example.com' }, now, env: ON, send }), /500/)
  assert.equal((await db.doc('invites/inv-5').get()).data().emailedAt, null)
})

test('welcome: once, only to the verified signed-in address, only after onboarding', async () => {
  const { sent, send } = outbox()
  const token = { uid: 'owner', email: 'owner@example.com', email_verified: true }
  await db.doc('users/owner').set({ onboarded: false })
  assert.equal((await sendWelcome({ db, uid: 'owner', token, now, env: ON, send })).reason, 'not_needed')
  await db.doc('users/owner').set({ onboarded: true, displayName: 'Maya' })
  assert.equal((await sendWelcome({ db, uid: 'owner', token: { ...token, email_verified: false }, now, env: ON, send })).reason, 'unverified')
  assert.deepEqual(await sendWelcome({ db, uid: 'owner', token, input: { language: 'fa' }, now, env: ON, send }), { sent: true })
  assert.equal((await sendWelcome({ db, uid: 'owner', token, now, env: ON, send })).reason, 'not_needed')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'owner@example.com')
  assert.match(sent[0].html, /dir="rtl"/)
  await db.doc('users/emp').set({ onboarded: true, accountType: 'employee' })
  assert.equal((await sendWelcome({ db, uid: 'emp', token: { ...token, uid: 'emp' }, now, env: ON, send })).reason, 'not_needed')
})

test('sendEmail posts one message from HENGAM with reply-to hello@hengam.app, and is off without a key', async () => {
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true, json: async () => ({ id: 'e1' }) } }
  assert.deepEqual(await sendEmail({ to: 'a@example.com', subject: 's', html: 'h', text: 't' }, { env: {}, fetchImpl }), { sent: false, reason: 'disabled' })
  assert.deepEqual(await sendEmail({ to: 'a@example.com', subject: 's', html: 'h', text: 't', tag: 'invite' }, { env: ON, fetchImpl }), { sent: true, id: 'e1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.resend.com/emails')
  assert.equal(calls[0].body.from, 'HENGAM <notifications@hengam.app>')
  assert.equal(calls[0].body.reply_to, 'hello@hengam.app')
  assert.deepEqual(calls[0].body.to, ['a@example.com'])
  const fail = async () => ({ ok: false, status: 422, json: async () => ({}) })
  await assert.rejects(sendEmail({ to: 'a@example.com', subject: 's', html: 'h', text: 't' }, { env: ON, fetchImpl: fail }), /422/)
})

test('helpers: escaping and address checks', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
  assert.equal(validEmail(' x@y.co '), 'x@y.co')
  assert.equal(validEmail('x@y'), null)
  assert.match(inviteEmail({ businessName: '', link: 'L' }).subject, /your manager/)
})
