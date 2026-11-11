import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { DEFAULT_THRESHOLDS, evaluate, thresholdsFrom } from '../../api/_ops-status.js'
import { recordError } from '../../api/_monitoring.js'
import { FIRESTORE, PROJECT_ID, clearFirestore, post, startApi } from './harness.js'

// /api/ops/status end to end: real handler, real Firestore (emulator), each
// alert driven by the data it watches.

const TOKEN = 'ops-test-token-0123456789abcdef'
let api, db
before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
  api = await startApi({ OPS_STATUS_TOKEN: TOKEN })
})
after(async () => { await api?.stop(); await Promise.all(getApps().map(deleteApp)) })
beforeEach(async () => {
  await clearFirestore()
  // A healthy baseline: the daily job ran an hour ago.
  await db.doc('meta/dailyJob').set({ lastRunAt: new Date(Date.now() - 3600_000), failed: [] })
})

const status = async (token = TOKEN) => {
  const r = await fetch(`${api.url}/api/ops/status`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  return { code: r.status, body: await r.json() }
}
const check = (body, name) => body.checks.find(c => c.name === name)
const day = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)

describe('access', () => {
  test('without OPS_STATUS_TOKEN configured the endpoint does not exist', async () => {
    const bare = await startApi()
    try {
      const r = await fetch(`${bare.url}/api/ops/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      assert.equal(r.status, 404)
    } finally { await bare.stop() }
  })
  test('no token or a wrong token is refused', async () => {
    assert.equal((await status(null)).code, 401)
    assert.equal((await status('x'.repeat(TOKEN.length))).code, 401)
    // Same character count, different byte count: must be a clean 401, not a crash.
    assert.equal((await status('é' + TOKEN.slice(1))).code, 401)
    // A query-string token is not accepted.
    assert.equal((await fetch(`${api.url}/api/ops/status?token=${TOKEN}`)).status, 401)
    assert.equal((await post(api, '/api/ops/status', { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405)
  })
})

describe('levels', () => {
  test('quiet production data is ok', async () => {
    await db.doc(`aiUsage/u1_${month()}`).set({ uid: 'u1', period: month(), spendUsd: 0.4, calls: 3, updatedAt: Timestamp.now() })
    const { code, body } = await status()
    assert.equal(code, 200)
    assert.equal(body.level, 'ok', JSON.stringify(body.checks))
  })

  test('server errors in the last hour warn, many are critical (503)', async () => {
    const err = new Error('Firestore exploded 12345')
    await recordError(db, { source: 'server', where: 'saveShift', error: err, uid: 'secret-uid-1' })
    let s = await status()
    assert.equal(check(s.body, 'server_errors').level, 'warn')
    assert.equal(s.code, 200)
    for (let i = 0; i < 12; i++) await recordError(db, { source: 'server', where: 'saveShift', error: err })
    s = await status()
    assert.equal(check(s.body, 'server_errors').level, 'critical')
    assert.equal(s.code, 503)
    assert.equal(s.body.level, 'critical')
    // Counts only: no uid, no message text leaves the endpoint.
    assert.doesNotMatch(JSON.stringify(s.body), /secret-uid-1|exploded/)
  })

  test('errors older than an hour do not alert', async () => {
    await recordError(db, { source: 'server', where: 'saveShift', error: new Error('old'), now: new Date(Date.now() - 2 * 3600_000) })
    assert.equal(check((await status()).body, 'server_errors').level, 'ok')
  })

  test('scheduling failures and auth issues reported by browsers are counted separately', async () => {
    await post(api, '/api/teams/reportClientError', { body: { message: 'TypeError', route: 'schedule.generate', platform: 'web' } })
    await post(api, '/api/teams/reportClientError', { body: { message: 'unavailable', route: 'schedule.rules.unavailable', platform: 'web' } })
    for (let i = 0; i < 4; i++) await post(api, '/api/teams/reportClientError', { body: { message: 'auth/internal-error', route: 'auth.signin', platform: 'web' } })
    const { body } = await status()
    assert.match(check(body, 'schedule_failures').detail, /^2 /)
    assert.equal(check(body, 'schedule_failures').level, 'warn')
    assert.equal(check(body, 'auth_issues').level, 'warn')
    assert.equal(check(body, 'server_errors').level, 'ok')
  })

  test('abnormal AI use: calls today, spend this month, accounts near cap, stuck holds', async () => {
    await db.doc(`aiUsage/u1_${day()}`).set({ uid: 'u1', period: day(), calls: 420 })
    await db.doc(`aiUsage/u1_${month()}`).set({ uid: 'u1', period: month(), spendUsd: 4.5, pendingUsd: 0.2, updatedAt: Timestamp.fromMillis(Date.now() - 30 * 60_000) })
    await db.doc(`aiUsage/teams-biz1_${month()}`).set({ bizId: 'biz1', period: month(), spendUsd: 0.1, updatedAt: Timestamp.now() })
    const { code, body } = await status()
    assert.equal(check(body, 'ai_calls_today').level, 'critical')
    assert.equal(check(body, 'ai_accounts_near_cap').level, 'warn')
    assert.equal(check(body, 'ai_stuck_holds').level, 'warn')
    assert.equal(check(body, 'ai_spend_month').level, 'ok')
    assert.equal(code, 503)
  })

  test('a daily job that has not run is a warning', async () => {
    await db.doc('meta/dailyJob').delete()
    assert.equal(check((await status()).body, 'daily_job').level, 'warn')
    await db.doc('meta/dailyJob').set({ lastRunAt: new Date(Date.now() - 30 * 3600_000), failed: [] })
    assert.equal(check((await status()).body, 'daily_job').level, 'warn')
  })

  test('limiter and AI-budget faults are recorded where the status sees them', async () => {
    await recordError(db, { source: 'server', where: 'rate-limit:promo', error: new Error('deadline') })
    await recordError(db, { source: 'server', where: 'ai-budget:busy', error: new Error('lock timeout') })
    const c = check((await status()).body, 'server_errors')
    assert.match(c.detail, /2 in the last hour across 2 distinct/)
  })
})

describe('evaluate and thresholds (pure)', () => {
  const quiet = { firestore: { ok: true, ms: 40 }, errors: { serverLastHour: 0, serverFingerprints: 0, scheduleLastHour: 0, authLastHour: 0 }, ai: { callsToday: 0, spendMonthUsd: 0, accounts: [] }, dailyJob: { lastRunAgeHours: 2, failed: [] } }
  test('Firestore down is critical', () => {
    assert.equal(evaluate({ ...quiet, firestore: { ok: false, ms: 5000 } }).level, 'critical')
  })
  test('thresholds can be tuned per environment', () => {
    const t = thresholdsFrom({ OPS_AI_SPEND_MONTH_WARN_USD: '1', OPS_SERVER_ERRORS_CRITICAL: '3' })
    assert.equal(t.aiSpendMonthWarnUsd, 1)
    assert.equal(t.serverErrorsCritical, 3)
    assert.equal(t.aiCallsTodayWarn, DEFAULT_THRESHOLDS.aiCallsTodayWarn)
    assert.equal(evaluate({ ...quiet, ai: { ...quiet.ai, spendMonthUsd: 1.5 } }, t).level, 'warn')
  })
})
