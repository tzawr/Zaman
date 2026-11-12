import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { hengamActionLink, sendPasswordReset, sendVerificationEmail } from '../../api/_auth-email.js'
import { AUTH, FIRESTORE, PROJECT_ID, clearAuth, clearFirestore, signUp } from './harness.js'

// HENGAM-branded verification and reset emails against the Auth emulator:
// real Firebase one-time codes, delivered by a fake sender.

let db, auth
before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
  auth = getAuth()
})
after(async () => { await Promise.all(getApps().map(deleteApp)) })
beforeEach(async () => { await clearFirestore(); await clearAuth() })

const ON = { RESEND_API_KEY: 'test', APP_ORIGIN: 'https://hengam.app' }
const now = new Date()
const outbox = () => { const sent = []; return { sent, send: async (m) => { sent.push(m); return { id: `re_${sent.length}` } } } }
const allow = async () => ({ allowed: true })
const linkIn = (m) => (m.text.match(/https:\/\/hengam\.app\/auth\/action\?[^\s]+/) || [])[0]
const lookup = async (uid) => (await auth.getUser(uid))

/** Applies a one-time code the way the browser page does, via the Auth REST API. */
async function apply(oobCode, extra = {}) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${extra.newPassword ? 'resetPassword' : 'update'}?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode, ...extra }),
  })
  return { status: r.status, body: await r.json() }
}

test('the link is HENGAM’s page with Firebase’s code, language and a safe continue path', () => {
  const l = new URL(hengamActionLink('https://zaman-ba689.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC&apiKey=k&lang=en', { language: 'fa', continuePath: '//evil.example' , env: ON }))
  assert.equal(l.origin + l.pathname, 'https://hengam.app/auth/action')
  assert.equal(l.searchParams.get('mode'), 'resetPassword')
  assert.equal(l.searchParams.get('oobCode'), 'ABC')
  assert.equal(l.searchParams.get('lang'), 'fa')
  assert.equal(l.searchParams.get('apiKey'), null, 'the API key is not carried in our links')
  assert.equal(l.searchParams.get('continue'), null, 'only same-site paths may continue')
})

test('verification: one branded email to the signed-in address; the code verifies the account', async () => {
  const user = await signUp()
  const { sent, send } = outbox()
  const r = await sendVerificationEmail({ db, token: { uid: user.uid, email: user.email, email_verified: false }, input: { language: 'fa' }, now, env: ON, send, auth })
  assert.deepEqual(r, { sent: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, user.email)
  assert.equal(sent[0].from, 'HENGAM Security <security@mail.hengam.app>')
  assert.match(sent[0].subject, /HENGAM/)
  assert.match(sent[0].html, /dir="rtl"/)
  const link = new URL(linkIn(sent[0]))
  assert.equal(link.searchParams.get('mode'), 'verifyEmail')
  assert.equal(link.searchParams.get('continue'), '/dashboard')
  assert.equal((await lookup(user.uid)).emailVerified, false)
  assert.equal((await apply(link.searchParams.get('oobCode'))).status, 200)
  assert.equal((await lookup(user.uid)).emailVerified, true)
  // Used once: the same code no longer works.
  assert.notEqual((await apply(link.searchParams.get('oobCode'))).status, 200)
})

test('verification: already verified sends nothing; email off asks the app to fall back to Firebase', async () => {
  const user = await signUp()
  const { sent, send } = outbox()
  assert.equal((await sendVerificationEmail({ db, token: { uid: user.uid, email: user.email, email_verified: true }, now, env: ON, send, auth })).reason, 'already_verified')
  assert.deepEqual(await sendVerificationEmail({ db, token: { uid: user.uid, email: user.email, email_verified: false }, now, env: {}, send, auth }), { sent: false, fallback: true })
  const failing = async () => { throw new Error('provider down') }
  assert.deepEqual(await sendVerificationEmail({ db, token: { uid: user.uid, email: user.email, email_verified: false }, now, env: ON, send: failing, auth }), { sent: false, fallback: true })
  assert.equal(sent.length, 0)
})

test('reset: a working link for a real account; the same answer and no email for an unknown one', async () => {
  const user = await signUp()
  const { sent, send } = outbox()
  assert.deepEqual(await sendPasswordReset({ db, input: { email: 'nobody@example.test' }, now, env: ON, send, auth, limit: allow }), { ok: true })
  assert.equal(sent.length, 0, 'nothing reveals whether an account exists')
  assert.deepEqual(await sendPasswordReset({ db, input: { email: user.email, language: 'en' }, now, env: ON, send, auth, limit: allow }), { ok: true })
  assert.equal(sent.length, 1)
  assert.match(sent[0].subject, /Reset your HENGAM password/)
  const code = new URL(linkIn(sent[0])).searchParams.get('oobCode')
  const r = await apply(code, { newPassword: 'brand-new-pass-1' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const signIn = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'brand-new-pass-1', returnSecureToken: true }) })
  assert.equal(signIn.status, 200)
})

test('reset: limited per address (quietly), bad input is ignored, provider failure falls back', async () => {
  const user = await signUp()
  const { sent, send } = outbox()
  const deny = async () => ({ allowed: false })
  assert.deepEqual(await sendPasswordReset({ db, input: { email: user.email }, now, env: ON, send, auth, limit: deny }), { ok: true })
  assert.deepEqual(await sendPasswordReset({ db, input: { email: 'not an email' }, now, env: ON, send, auth, limit: allow }), { ok: true })
  assert.equal(sent.length, 0)
  const failing = async () => { throw new Error('provider down') }
  assert.deepEqual(await sendPasswordReset({ db, input: { email: user.email }, now, env: ON, send: failing, auth, limit: allow }), { ok: true, fallback: true })
})

test('reset: an enumeration-protected "no link" answer is treated as no account (same answer, nothing sent)', async () => {
  const { sent, send } = outbox()
  const fakeAuth = { generatePasswordResetLink: async () => { throw Object.assign(new Error('INTERNAL ASSERT FAILED: Unable to create the email action link'), { code: 'auth/internal-error' }) } }
  assert.deepEqual(await sendPasswordReset({ db, input: { email: 'someone@example.test' }, now, env: ON, send, auth: fakeAuth, limit: allow }), { ok: true })
  assert.equal(sent.length, 0)
  const brokenAuth = { generatePasswordResetLink: async () => { throw Object.assign(new Error('backend unavailable'), { code: 'auth/internal-error' }) } }
  assert.deepEqual(await sendPasswordReset({ db, input: { email: 'someone@example.test' }, now, env: ON, send, auth: brokenAuth, limit: allow }), { ok: true, fallback: true })
})
