import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { hengamActionLink, requestEmailChange, sendPasswordReset, sendVerificationEmail } from '../../api/_auth-email.js'
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

const fresh = (user) => ({ uid: user.uid, email: user.email, auth_time: Math.floor(+now / 1000) - 30 })

test('email change: one branded email to the NEW address only; the code changes the sign-in email', async () => {
  const user = await signUp()
  const { sent, send } = outbox()
  const newEmail = `moved-${user.uid.slice(0, 8).toLowerCase()}@example.test`
  assert.deepEqual(await requestEmailChange({ db, token: fresh(user), input: { newEmail, language: 'en' }, now, env: ON, send, auth, limit: allow }), { sent: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, newEmail)
  assert.equal(sent[0].from, 'HENGAM Security <security@mail.hengam.app>')
  assert.match(sent[0].subject, /Confirm your new HENGAM sign-in email/)
  const link = new URL(linkIn(sent[0]))
  assert.equal(link.searchParams.get('mode'), 'verifyAndChangeEmail')
  assert.equal(link.searchParams.get('continue'), '/signin')
  assert.equal((await lookup(user.uid)).email, user.email, 'nothing changes until the link is opened')
  assert.equal((await apply(link.searchParams.get('oobCode'))).status, 200)
  assert.equal((await lookup(user.uid)).email, newEmail)
  assert.notEqual((await apply(link.searchParams.get('oobCode'))).status, 200, 'used once')
})

test('email change: needs a recent sign-in; rejects bad, unchanged and over-limit requests without sending', async () => {
  const user = await signUp()
  const { sent, send } = outbox()
  const base = { db, now, env: ON, send, auth, limit: allow }
  const stale = { ...fresh(user), auth_time: Math.floor(+now / 1000) - 6 * 60 }
  assert.equal((await requestEmailChange({ ...base, token: stale, input: { newEmail: 'new@example.test' } })).reason, 'requires_recent_login')
  assert.equal((await requestEmailChange({ ...base, token: { ...fresh(user), auth_time: undefined }, input: { newEmail: 'new@example.test' } })).reason, 'requires_recent_login')
  assert.equal((await requestEmailChange({ ...base, token: fresh(user), input: { newEmail: 'not an email' } })).reason, 'invalid_email')
  assert.equal((await requestEmailChange({ ...base, token: fresh(user), input: { newEmail: user.email.toUpperCase() } })).reason, 'same_email')
  assert.equal((await requestEmailChange({ ...base, token: fresh(user), input: { newEmail: 'new@example.test' }, limit: async () => ({ allowed: false }) })).reason, 'rate_limited')
  assert.equal(sent.length, 0)
  assert.equal((await lookup(user.uid)).email, user.email)
})

test('email change: email off or provider down falls back to Firebase; an address already in use gets the same answer and no email', async () => {
  const user = await signUp()
  const other = await signUp()
  const { sent, send } = outbox()
  const base = { db, token: fresh(user), now, send, auth, limit: allow }
  assert.deepEqual(await requestEmailChange({ ...base, input: { newEmail: 'new@example.test' }, env: {} }), { sent: false, fallback: true })
  const failing = async () => { throw new Error('provider down') }
  assert.deepEqual(await requestEmailChange({ ...base, input: { newEmail: 'new@example.test' }, env: ON, send: failing }), { sent: false, fallback: true })
  assert.deepEqual(await requestEmailChange({ ...base, input: { newEmail: other.email }, env: ON }), { sent: true })
  assert.equal(sent.length, 0, 'nothing reveals that the other address has an account')
  assert.equal((await lookup(user.uid)).email, user.email)
})

/** A Google-only account in the Auth emulator, signed in now; returns its real ID token. */
async function googleUser(tag) {
  const claims = { sub: `g-${tag}-${Date.now()}`, email: `google-${tag}-${Date.now()}@example.test`, email_verified: true }
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(JSON.stringify(claims))}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true }),
  })
  const b = await r.json()
  assert.equal(r.status, 200, JSON.stringify(b))
  return { uid: b.localId, email: claims.email, idToken: b.idToken }
}
async function passwordToken(user) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'test-pass-123', returnSecureToken: true }) })
  return (await r.json()).idToken
}

test('email change, server-side: real verified tokens for password and Google-only accounts; fresh passes, five minutes later refused', async () => {
  const pw = await signUp()
  const g = await googleUser('ec')
  assert.deepEqual((await lookup(g.uid)).providerData.map(p => p.providerId), ['google.com'], 'Google-only account')
  for (const [label, uid, idToken] of [['password', pw.uid, await passwordToken(pw)], ['google', g.uid, g.idToken]]) {
    const token = await auth.verifyIdToken(idToken)
    assert.ok(Number(token.auth_time) > 0, `${label}: the verified token carries auth_time`)
    const { sent, send } = outbox()
    const signedInAt = new Date(token.auth_time * 1000)
    const later = new Date(+signedInAt + 5 * 60 * 1000 + 1000)
    const r1 = await requestEmailChange({ db, token, input: { newEmail: `late-${label}-${Date.now()}@example.test` }, now: later, env: ON, send, auth, limit: allow })
    assert.equal(r1.reason, 'requires_recent_login', `${label}: refused after five minutes`)
    assert.equal(sent.length, 0)
    const r2 = await requestEmailChange({ db, token, input: { newEmail: `fresh-${label}-${Date.now()}@example.test` }, now: new Date(+signedInAt + 60 * 1000), env: ON, send, auth, limit: allow })
    assert.deepEqual(r2, { sent: true }, `${label}: allowed within five minutes`)
    assert.equal(sent.length, 1)
    assert.equal((await lookup(uid)).email, uid === g.uid ? g.email : pw.email, `${label}: unchanged until the link is opened`)
  }
})
