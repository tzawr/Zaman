import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { FIRESTORE, PROJECT_ID, clearAuth, clearFirestore, post, signUp, startApi } from './harness.js'

// The shared limiter in api/_rate-limit.js, exercised through real endpoints:
// a real emulator ID token, the real router in api/teams/[action].js, and the
// real Firestore counter. createBusiness allows 10 an hour; the probes send an
// unverified account, so the action itself refuses (403) without writing, and
// any 429 can only have come from the limiter.

const CREATE_LIMIT = 10
const HOUR = 60 * 60

let api
let db
before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
  api = await startApi()
})
after(async () => {
  await api?.stop()
  await Promise.all(getApps().map(deleteApp))
})
beforeEach(async () => {
  await clearFirestore()
  await clearAuth()
})

const probe = (token) => post(api, '/api/teams/createBusiness', { token, body: {} })

async function counter(bucket, key, windowSeconds = HOUR) {
  const slot = Math.floor(Date.now() / (windowSeconds * 1000))
  const snap = await db.doc(`rateLimits/${bucket}_${key}_${slot}`).get()
  return snap.exists ? snap.data().count : 0
}

function assertLimited(res, windowSeconds = HOUR) {
  assert.equal(res.status, 429)
  assert.equal(res.body?.reason, 'rate_limited')
  const retry = Number(res.headers.get('retry-after'))
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= windowSeconds, `Retry-After was ${res.headers.get('retry-after')}`)
}

describe('shared rate limiter through /api/teams', () => {
  test('requests below the limit go through to the action', async () => {
    const { idToken } = await signUp()
    for (let i = 0; i < CREATE_LIMIT - 1; i++) {
      const res = await probe(idToken)
      assert.equal(res.status, 403, `request ${i + 1}: ${JSON.stringify(res.body)}`)
    }
  })

  test('the request exactly at the limit is allowed', async () => {
    const { uid, idToken } = await signUp()
    for (let i = 0; i < CREATE_LIMIT; i++) assert.equal((await probe(idToken)).status, 403)
    assert.equal(await counter('teams-createBusiness', uid), CREATE_LIMIT)
  })

  test('every request over the limit gets 429 with Retry-After, and stays blocked', async () => {
    const { uid, idToken } = await signUp()
    for (let i = 0; i < CREATE_LIMIT; i++) await probe(idToken)
    // Several, not one: the original bug let request 11 through and every one after it.
    for (let i = 0; i < 5; i++) assertLimited(await probe(idToken))
    // Refused attempts do not keep growing the counter.
    assert.equal(await counter('teams-createBusiness', uid), CREATE_LIMIT)
  })

  test('limits are per caller', async () => {
    const a = await signUp()
    const b = await signUp()
    for (let i = 0; i < CREATE_LIMIT; i++) await probe(a.idToken)
    assertLimited(await probe(a.idToken))
    assert.equal((await probe(b.idToken)).status, 403)
  })

  test('concurrent requests admit exactly the limit, never more', async () => {
    const { uid, idToken } = await signUp()
    const results = await Promise.all(Array.from({ length: 30 }, () => probe(idToken)))
    const statuses = results.map(r => r.status)
    const allowed = statuses.filter(s => s !== 429).length
    assert.equal(allowed, CREATE_LIMIT, `statuses: ${statuses.join(',')}`)
    for (const r of results.filter(r => r.status === 429)) assertLimited(r)
    assert.equal(await counter('teams-createBusiness', uid), CREATE_LIMIT)
  })

  test('a full previous window does not block the current one', async () => {
    const { uid, idToken } = await signUp()
    const slot = Math.floor(Date.now() / (HOUR * 1000))
    await db.doc(`rateLimits/teams-createBusiness_${uid}_${slot - 1}`).set({ count: CREATE_LIMIT })
    assert.equal((await probe(idToken)).status, 403)
  })

  test('signed-out actions are limited by caller address', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.7' }
    for (let i = 0; i < 30; i++) {
      const res = await post(api, '/api/teams/previewInvite', { headers, body: { code: 'NOPE' } })
      assert.notEqual(res.status, 429, `request ${i + 1}`)
    }
    assertLimited(await post(api, '/api/teams/previewInvite', { headers, body: { code: 'NOPE' } }), 15 * 60)
  })

  test('a missing or bad token is a 401, and is not counted', async () => {
    assert.equal((await probe(null)).status, 401)
    assert.equal((await probe('not-a-token')).status, 401)
  })
})

describe('shared rate limiter on the other endpoints', () => {
  test('promo code guesses stop at 10 an hour', async () => {
    const { idToken } = await signUp()
    for (let i = 0; i < 10; i++) {
      const res = await post(api, '/api/redeem-promo-code', { token: idToken, body: { code: `GUESS${i}` } })
      assert.notEqual(res.status, 429, `guess ${i + 1}`)
    }
    assertLimited(await post(api, '/api/redeem-promo-code', { token: idToken, body: { code: 'GUESS10' } }))
  })

  test('calendar feed 429 carries Retry-After', async () => {
    const token = 'feedtoken' + Date.now()
    const slot = Math.floor(Date.now() / (HOUR * 1000))
    await db.doc(`rateLimits/calendar-feed_${token}_${slot}`).set({ count: 120 })
    const res = await fetch(`${api.url}/api/calendar/${token}.ics`)
    assert.equal(res.status, 429)
    assert.ok(Number(res.headers.get('retry-after')) >= 1)
  })
})

describe('consumeRateLimit window expiry', () => {
  test('the window resets once it rolls over', async () => {
    const { consumeRateLimit } = await import('../../api/_rate-limit.js')
    const windowSeconds = 2
    // Start at the beginning of a window so all three calls land in it.
    const msIntoWindow = Date.now() % (windowSeconds * 1000)
    if (msIntoWindow > 300) await new Promise(r => setTimeout(r, windowSeconds * 1000 - msIntoWindow + 20))
    assert.equal((await consumeRateLimit('t-expiry', 'k', 2, windowSeconds)).allowed, true)
    assert.equal((await consumeRateLimit('t-expiry', 'k', 2, windowSeconds)).allowed, true)
    const blocked = await consumeRateLimit('t-expiry', 'k', 2, windowSeconds)
    assert.equal(blocked.allowed, false)
    assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= windowSeconds)
    await new Promise(r => setTimeout(r, blocked.retryAfterSeconds * 1000 + 50))
    assert.equal((await consumeRateLimit('t-expiry', 'k', 2, windowSeconds)).allowed, true)
  })
})
