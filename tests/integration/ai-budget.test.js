import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as ws from '../../api/_teams-workspaces.js'
import { importSchedule } from '../../api/_teams-imports.js'
import { MAX_AI_IMPORTS_PER_DAY, MONTHLY_IMPORT_BUDGET_USD } from '../../api/_teams-extract.js'
import { FIRESTORE, PROJECT_ID, clearAuth, clearFirestore, post, signUp, startApi } from './harness.js'

// Bursts against the two AI spend caps. The provider is a local mock that
// answers slowly, which is what widens the window a check-then-spend race
// needs. No request in this file can reach a paid API: the API server is
// started with ANTHROPIC_BASE_URL pointing at the mock and a fake key, and
// the Teams path takes an injected client.

let api
let mock
let providerCalls = 0
let db

before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
  mock = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    providerCalls++
    await new Promise(r => setTimeout(r, 250))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 1000, output_tokens: 500 } }))
  })
  await new Promise(r => mock.listen(0, '127.0.0.1', r))
  api = await startApi({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}` })
})
after(async () => {
  await api?.stop()
  await new Promise(r => mock.close(r))
  await Promise.all(getApps().map(deleteApp))
})
beforeEach(async () => {
  await clearFirestore()
  await clearAuth()
  providerCalls = 0
})

const month = () => new Date().toISOString().slice(0, 7)
const day = () => new Date().toISOString().slice(0, 10)

async function proUser() {
  const user = await signUp()
  await db.doc(`users/${user.uid}`).set({ tier: 'pro' })
  return user
}

const generate = (token) => post(api, '/api/generate-schedule', { token, body: { prompt: 'Two baristas every morning.', task: 'recommendations' } })

describe('Hengam AI budget (/api/generate-schedule)', () => {
  test('a burst cannot exceed the daily call cap', async () => {
    const { uid, idToken } = await proUser()
    const results = await Promise.all(Array.from({ length: 60 }, () => generate(idToken)))
    const statuses = results.map(r => r.status)
    const ok = statuses.filter(s => s === 200).length
    // Every response is a success, the cap (429) or contention (503). Never a 500.
    assert.deepEqual([...new Set(statuses)].filter(s => ![200, 429, 503].includes(s)), [], `statuses: ${statuses.join(',')}`)
    assert.ok(ok <= 40, `allowed ${ok}`)
    assert.equal(providerCalls, ok, 'the provider is called once per allowed request, never more')
    for (const r of results.filter(r => r.status === 503)) assert.ok(Number(r.headers.get('retry-after')) > 0)
    const usage = (await db.doc(`aiUsage/${uid}_${month()}`).get()).data()
    assert.equal(usage.calls, ok)
    assert.ok(Math.abs(usage.pendingUsd) < 1e-9, 'every hold was settled')
    assert.equal((await db.doc(`aiUsage/${uid}_${day()}`).get()).data().calls, ok)
    // Retrying after the burst fills the day exactly to the cap and no further.
    let more = 0
    for (let i = 0; i < 45; i++) if ((await generate(idToken)).status === 200) more++
    assert.equal(ok + more, 40)
    assert.equal(providerCalls, 40)
  })

  test('a burst near the monthly cap stops at the cap', async () => {
    const { uid, idToken } = await proUser()
    // $0.10 left. Each call holds ~$0.026 (1024 output tokens at $25/M) and
    // actually costs $0.0175 (the mock's 1,000 in / 500 out), so at most four
    // run at once and six fit in all.
    await db.doc(`aiUsage/${uid}_${month()}`).set({ spendUsd: 4.9 })
    const results = await Promise.all(Array.from({ length: 20 }, () => generate(idToken)))
    for (let i = 0; i < 10; i++) results.push(await generate(idToken))
    const ok = results.filter(r => r.status === 200).length
    assert.ok(ok >= 1 && ok <= 6, `allowed ${ok}`)
    assert.equal(providerCalls, ok)
    const usage = (await db.doc(`aiUsage/${uid}_${month()}`).get()).data()
    // Under the old check-then-spend code all 20 concurrent calls could pass.
    assert.ok(usage.spendUsd < 5 + 0.0175, `spend ${usage.spendUsd}`)
    assert.ok(Math.abs(usage.pendingUsd) < 1e-9)
  })

  test('a failed provider call is not billed and gives the call back', async () => {
    const { uid, idToken } = await proUser()
    const bad = await startApi({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' })
    try {
      const res = await post(bad, '/api/generate-schedule', { token: idToken, body: { prompt: 'x', task: 'rules' } })
      assert.equal(res.status, 500)
    } finally {
      await bad.stop()
    }
    const usage = (await db.doc(`aiUsage/${uid}_${month()}`).get()).data()
    assert.ok(Math.abs(usage.pendingUsd) < 1e-9)
    assert.equal(usage.spendUsd ?? 0, 0)
    assert.equal((await db.doc(`aiUsage/${uid}_${day()}`).get()).data().calls, 0)
  })

  test('free accounts never reach the provider', async () => {
    const { idToken } = await signUp()
    assert.equal((await generate(idToken)).status, 403)
    assert.equal(providerCalls, 0)
  })
})

describe('Teams import budget (photo/PDF)', () => {
  const now = new Date('2026-10-20T17:00:00Z')
  const token = (uid) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid })
  const call = (fn, uid, input, extra = {}) => fn({ db, uid, token: token(uid), input, now, ...extra })
  let reads = 0
  const slowClaude = {
    messages: {
      stream: () => {
        reads++
        return {
          finalMessage: async () => {
            await new Promise(r => setTimeout(r, 200))
            return { stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 1000 }, content: [{ type: 'text', text: JSON.stringify({ shifts: [{ employee: 'Ana', date: '2026-10-27', weekday: '', start: '09:00', end: '17:00', position: '', location: '', unclear: [] }], notes: '' }) }] }
          },
        }
      },
    },
  }

  test('a burst cannot exceed the daily import cap', async () => {
    reads = 0
    const { bizId } = await call(ws.createBusiness, 'owner', { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: 'req-burst-01' })
    const input = { bizId, weekStart: '2026-10-26', fileName: 'a.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') }
    const results = await Promise.allSettled(Array.from({ length: 35 }, () => call(importSchedule, 'owner', input, { aiClient: slowClaude })))
    const reasons = results.map(r => (r.status === 'fulfilled' ? 'ok' : r.reason?.reason))
    assert.deepEqual([...new Set(reasons)].filter(r => !['ok', 'budget', 'busy'].includes(r)), [], reasons.join(','))
    const ok = reasons.filter(r => r === 'ok').length
    assert.equal(reads, ok, 'one provider read per accepted import')
    assert.ok(ok <= MAX_AI_IMPORTS_PER_DAY, `accepted ${ok}`)
    for (let i = 0; i < 25; i++) await call(importSchedule, 'owner', input, { aiClient: slowClaude }).catch(() => {})
    assert.equal(reads, MAX_AI_IMPORTS_PER_DAY, `provider reads: ${reads}`)
    const usage = (await db.doc(`aiUsage/teams-${bizId}_2026-10`).get()).data()
    assert.equal(usage.calls, MAX_AI_IMPORTS_PER_DAY)
    assert.ok(usage.spendUsd < MONTHLY_IMPORT_BUDGET_USD)
    assert.ok(Math.abs(usage.pendingUsd) < 1e-9)
  })
})
