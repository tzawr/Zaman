import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { clientIp, normalizeIp } from '../../api/_teams-http.js'
import { FIRESTORE, PROJECT_ID, clearFirestore, post, startApi } from './harness.js'

// Who a signed-out caller is, for rate limiting, and whether a caller can
// change that by writing headers. The integration half runs the real router;
// "on Vercel" is simulated with VERCEL=1, with the test playing the platform
// by setting x-vercel-forwarded-for. Whether Vercel itself behaves as its docs
// say is checked on staging (loadtest/staging/xff-probe.mjs).

const req = (headers, socket = '10.0.0.9') => ({ headers, socket: { remoteAddress: socket } })

describe('clientIp', () => {
  test('off Vercel, headers are ignored: the socket address is the identity', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.5.5.5', 'x-vercel-forwarded-for': '6.6.6.6' }), {}), '10.0.0.9')
  })
  test('on Vercel, the platform header wins over anything in X-Forwarded-For', () => {
    assert.equal(clientIp(req({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': '1.2.3.4' }), { VERCEL: '1' }), '9.9.9.9')
    assert.equal(clientIp(req({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.2.3.4' }), { VERCEL: '1' }), '8.8.8.8')
  })
  test('the X-Forwarded-For fallback takes the last hop, never the caller-written first one', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }), { VERCEL: '1' }), '7.7.7.7')
  })
  test('IPv6 collapses to its /64; junk is one shared bucket', () => {
    assert.equal(normalizeIp('2001:db8:abcd:12::1'), normalizeIp('2001:0db8:abcd:0012:ffff:1:2:3'))
    assert.equal(normalizeIp('[2001:db8::1]'), '2001:db8:0:0::/64')
    assert.equal(normalizeIp('::ffff:203.0.113.5'), '203.0.113.5')
    for (const junk of ['', 'evil', '1.2.3', '<script>', 'unknown']) assert.equal(normalizeIp(junk), 'unknown')
  })
})

let db
before(() => {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
})
after(async () => { await Promise.all(getApps().map(deleteApp)) })
beforeEach(clearFirestore)

const preview = (api, headers) => post(api, '/api/teams/previewInvite', { headers, body: { code: 'NOPE' } })
const forged = (i) => `198.51.100.${i}, 10.${i}.0.1`

describe('signed-out limits through the router', () => {
  test('off Vercel, rotating X-Forwarded-For does not mint new identities', async () => {
    const api = await startApi()
    try {
      for (let i = 0; i < 30; i++) assert.notEqual((await preview(api, { 'x-forwarded-for': forged(i) })).status, 429, `request ${i + 1}`)
      assert.equal((await preview(api, { 'x-forwarded-for': forged(99) })).status, 429)
    } finally { await api.stop() }
  })

  describe('on Vercel (simulated)', () => {
    let api
    before(async () => { api = await startApi({ VERCEL: '1' }) })
    after(async () => { await api?.stop() })

    test('a forged X-Forwarded-For is ignored in favour of the platform header', async () => {
      for (let i = 0; i < 30; i++) {
        const r = await preview(api, { 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': forged(i) })
        assert.notEqual(r.status, 429, `request ${i + 1}`)
      }
      assert.equal((await preview(api, { 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': forged(77) })).status, 429)
      // Someone else is unaffected.
      assert.notEqual((await preview(api, { 'x-vercel-forwarded-for': '203.0.113.10' })).status, 429)
    })

    test('rotating addresses inside one IPv6 /64 counts as one caller', async () => {
      for (let i = 0; i < 30; i++) {
        assert.notEqual((await preview(api, { 'x-vercel-forwarded-for': `2001:db8:1:2::${(i + 1).toString(16)}` })).status, 429)
      }
      assert.equal((await preview(api, { 'x-vercel-forwarded-for': '2001:db8:1:2:aaaa::1' })).status, 429)
    })

    test('the shared ceiling stops fresh addresses once every caller together has used it', async () => {
      const slot = Math.floor(Date.now() / (15 * 60 * 1000))
      for (let s = 0; s < 10; s++) await db.doc(`rateLimits/teams-previewInvite-everyone_s${s}_${slot}`).set({ count: 60 })
      const r = await preview(api, { 'x-vercel-forwarded-for': '192.0.2.200' })
      assert.equal(r.status, 429)
      assert.match(r.body.message, /busy/)
      assert.ok(Number(r.headers.get('retry-after')) > 0)
    })
  })
})
