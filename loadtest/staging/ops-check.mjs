#!/usr/bin/env node
// Monitoring scenarios against the STAGING deployment (never production):
// /api/ops/status access control, healthy and degraded states, each alert
// pushed over its threshold and recovered, and a sensitive-data scan of every
// response. Real code paths are used where they exist (AI provider failure,
// AI budget limit, browser error reports, the daily cron); data is seeded only
// where a real path would need hours or hundreds of requests, and every
// synthetic document is removed at the end.
//
//   node loadtest/staging/ops-check.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkRun } from '../lib/guard.js'
import { targetsPath } from '../lib/targets.mjs'

const lt = resolve(import.meta.dirname, '..')
const cfg = JSON.parse(readFileSync(resolve(lt, '.data/staging.json'), 'utf8'))
const targets = JSON.parse(readFileSync(targetsPath(lt), 'utf8'))
checkRun({ urls: [cfg.appUrl], profile: 'smoke', projectId: cfg.projectId, targets })
const sa = JSON.parse(readFileSync(cfg.serviceAccountPath, 'utf8'))
if (sa.project_id !== cfg.projectId || cfg.projectId === 'zaman-ba689') throw new Error('not the staging project')
if (!cfg.opsStatusToken) throw new Error('staging has no OPS_STATUS_TOKEN; deploy with loadtest/staging/deploy.mjs first')

const { initializeApp, cert } = await import('firebase-admin/app')
const { getFirestore, Timestamp } = await import('firebase-admin/firestore')
const { getAuth } = await import('firebase-admin/auth')
initializeApp({ credential: cert(sa) })
const db = getFirestore()
const auth = getAuth()
const { recordError } = await import('../../api/_monitoring.js')

const BYPASS = { 'x-vercel-protection-bypass': cfg.bypassSecret }
const TAG = `opscheck${Date.now().toString(36)}`
const now = () => new Date()
const day = () => now().toISOString().slice(0, 10)
const month = () => now().toISOString().slice(0, 7)
const results = []
const responses = []
let failures = 0
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function status(token = cfg.opsStatusToken, extra = {}) {
  const r = await fetch(`${cfg.appUrl}/api/ops/status${extra.query || ''}`, {
    method: extra.method || 'GET',
    headers: { ...BYPASS, ...(token !== null ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const text = await r.text()
  responses.push(text)
  let body = null
  try { body = JSON.parse(text) } catch { /* not json */ }
  return { code: r.status, body }
}
const check = (s, name) => s.body?.checks?.find(c => c.name === name)

// Synthetic state lives under recognisable ids so cleanup is exact.
const created = { errorEvents: [], aiUsage: [], users: [] }
async function clearMonitoringState() {
  // Staging only: start each run from a clean, known state.
  const ev = await db.collection('errorEvents').get()
  await Promise.all(ev.docs.map(d => d.ref.delete()))
  for (const period of [day(), month()]) {
    const u = await db.collection('aiUsage').where('period', '==', period).get()
    await Promise.all(u.docs.map(d => d.ref.delete()))
  }
}
async function ageErrorEvents() {
  // Recovery: errors stop counting once they are more than an hour old.
  const ev = await db.collection('errorEvents').where('day', '==', day()).get()
  const old = Timestamp.fromMillis(Date.now() - 2 * 3600_000)
  await Promise.all(ev.docs.map(d => d.ref.update({ lastSeen: old })))
}
async function runCron() {
  const r = await fetch(`${cfg.appUrl}/api/cron/daily`, { headers: { ...BYPASS, Authorization: `Bearer ${cfg.cronSecret}` } })
  return { code: r.status, body: await r.json().catch(() => null) }
}
async function idToken(uid) {
  const custom = await auth.createCustomToken(uid)
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${cfg.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return (await r.json()).idToken
}
const generate = (token, prompt) => fetch(`${cfg.appUrl}/api/generate-schedule`, {
  method: 'POST', headers: { ...BYPASS, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ prompt, task: 'rules' }),
}).then(async r => ({ code: r.status, body: await r.json().catch(() => null) }))
const report = (where, message) => fetch(`${cfg.appUrl}/api/teams/reportClientError`, {
  method: 'POST', headers: { ...BYPASS, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, route: where, platform: 'web' }),
}).then(r => r.status)

// Sensitive values that must never appear in a monitoring response.
const SECRET_EMPLOYEE = `Zelda Quartermain ${TAG}`
const SECRET_EMAIL = `${TAG}.private@example.test`
const SECRET_RULE = `Never schedule ${SECRET_EMPLOYEE} on Mondays`

try {
  // ---- 1. Access control ---------------------------------------------------
  record('no token → 401', (await status(null)).code === 401)
  record('wrong token → 401', (await status('0'.repeat(cfg.opsStatusToken.length))).code === 401)
  record('multi-byte token of equal length → 401 (not 500)', (await status(`é${cfg.opsStatusToken.slice(1)}`)).code === 401)
  record('token in query string → 401', (await status(null, { query: `?token=${cfg.opsStatusToken}` })).code === 401)
  record('POST → 405', (await status(cfg.opsStatusToken, { method: 'POST' })).code === 405)
  const plain = await fetch(`${cfg.appUrl}/api/ops/status`, { redirect: 'manual' })
  record('without the Vercel bypass the deployment refuses (protected)', [401, 403, 302, 307].includes(plain.status), `HTTP ${plain.status}`)

  // ---- 2. Healthy ----------------------------------------------------------
  await clearMonitoringState()
  const cron = await runCron()
  record('daily cron runs on staging and writes its heartbeat', cron.code === 200, `HTTP ${cron.code}`)
  let s = await status()
  record('healthy: level ok, HTTP 200', s.code === 200 && s.body?.level === 'ok', JSON.stringify(s.body?.checks?.filter(c => c.level !== 'ok')))
  record('response carries version and time', /^([0-9a-f]{7}|local)$/.test(s.body?.version || '') && Boolean(s.body?.at), s.body?.version) // CLI deploys report 'local'; Git deploys the commit

  // ---- 3. AI provider failure (real path; provider unreachable on staging) --
  const uid = `${TAG}-pro`
  await auth.createUser({ uid, email: SECRET_EMAIL, displayName: SECRET_EMPLOYEE, emailVerified: true })
  created.users.push(uid)
  await db.doc(`users/${uid}`).set({ tier: 'pro', email: SECRET_EMAIL })
  const token = await idToken(uid)
  const g = await generate(token, SECRET_RULE)
  record('AI provider failure answers a clean 5xx, no paid call', g.code >= 500 && g.code < 600 && !JSON.stringify(g.body).includes('127.0.0.1'), `HTTP ${g.code}`)
  const hold = (await db.doc(`aiUsage/${uid}_${month()}`).get()).data()
  record('failed call released its budget hold', Math.abs(Number(hold?.pendingUsd) || 0) < 1e-9, `pendingUsd ${hold?.pendingUsd}`)
  s = await status()
  record('provider failure → server_errors warn', check(s, 'server_errors')?.level === 'warn', check(s, 'server_errors')?.detail)

  // ---- 4. Critical server errors and recovery ------------------------------
  for (let i = 0; i < 10; i++) await generate(token, SECRET_RULE)
  s = await status()
  record('≥10 server errors in an hour → critical, HTTP 503', s.code === 503 && check(s, 'server_errors')?.level === 'critical', check(s, 'server_errors')?.detail)
  await ageErrorEvents()
  s = await status()
  record('recovery: errors older than an hour → back to ok, HTTP 200', s.code === 200 && check(s, 'server_errors')?.level === 'ok')

  // ---- 5. AI budget limit (real 429 path) ----------------------------------
  await db.doc(`aiUsage/${uid}_${month()}`).set({ uid, period: month(), spendUsd: 5, pendingUsd: 0, calls: 1, updatedAt: Timestamp.now() })
  const limited = await generate(token, SECRET_RULE)
  record('account at its monthly cap → 429 before any provider call', limited.code === 429 && limited.body?.error === 'Limit reached', `HTTP ${limited.code}`)
  s = await status()
  record('account at cap → ai_accounts_near_cap warn', check(s, 'ai_accounts_near_cap')?.level === 'warn')
  // Abnormal spending across accounts (seeded totals).
  await db.doc(`aiUsage/${TAG}-a_${month()}`).set({ uid: `${TAG}-a`, period: month(), spendUsd: 47, updatedAt: Timestamp.now() })
  await db.doc(`aiUsage/${TAG}-a_${day()}`).set({ uid: `${TAG}-a`, period: day(), calls: 420 })
  await db.doc(`aiUsage/${TAG}-b_${month()}`).set({ uid: `${TAG}-b`, period: month(), spendUsd: 0.1, pendingUsd: 0.05, updatedAt: Timestamp.fromMillis(Date.now() - 40 * 60_000) })
  s = await status()
  record('monthly AI spend ≥ $50 → critical', check(s, 'ai_spend_month')?.level === 'critical', check(s, 'ai_spend_month')?.detail)
  record('AI calls today ≥ 400 → critical', check(s, 'ai_calls_today')?.level === 'critical', check(s, 'ai_calls_today')?.detail)
  record('budget hold stuck > 15 min → warn', check(s, 'ai_stuck_holds')?.level === 'warn')
  record('any critical → HTTP 503', s.code === 503)
  for (const id of [`${uid}_${month()}`, `${uid}_${day()}`, `${TAG}-a_${month()}`, `${TAG}-a_${day()}`, `${TAG}-b_${month()}`]) await db.doc(`aiUsage/${id}`).delete()
  s = await status()
  record('recovery: AI checks back to ok', ['ai_spend_month', 'ai_calls_today', 'ai_accounts_near_cap', 'ai_stuck_holds'].every(n => check(s, n)?.level === 'ok'))

  // ---- 6. Scheduling failures and auth issues reported by browsers ---------
  const codes = [await report('schedule.generate', 'TypeError'), await report('schedule.rules.unavailable', 'unavailable')]
  record('browser reports accepted by reportClientError', codes.every(c => c === 200), codes.join(','))
  s = await status()
  record('scheduling failures → warn', check(s, 'schedule_failures')?.level === 'warn', check(s, 'schedule_failures')?.detail)
  for (let i = 0; i < 5; i++) await recordError(db, { source: 'app', where: 'schedule.generate', error: new Error('TypeError') })
  s = await status()
  record('≥5 scheduling failures in an hour → critical', check(s, 'schedule_failures')?.level === 'critical')
  for (let i = 0; i < 3; i++) await report('auth.signin', 'auth/internal-error')
  s = await status()
  record('unexpected sign-in errors ≥3 → auth_issues warn', check(s, 'auth_issues')?.level === 'warn', check(s, 'auth_issues')?.detail)
  for (let i = 0; i < 20; i++) await recordError(db, { source: 'app', where: 'auth.signin', error: new Error('auth/internal-error') })
  s = await status()
  record('≥20 auth issues in an hour → critical', check(s, 'auth_issues')?.level === 'critical')
  await ageErrorEvents()
  s = await status()
  record('recovery: scheduling and auth checks back to ok', check(s, 'schedule_failures')?.level === 'ok' && check(s, 'auth_issues')?.level === 'ok')

  // ---- 7. Daily job ---------------------------------------------------------
  await db.doc('meta/dailyJob').set({ lastRunAt: new Date(Date.now() - 30 * 3600_000), failed: [] })
  s = await status()
  record('daily job silent for 30 h → warn', check(s, 'daily_job')?.level === 'warn', check(s, 'daily_job')?.detail)
  await runCron()
  s = await status()
  record('recovery: cron run → daily_job ok', check(s, 'daily_job')?.level === 'ok')

  // ---- 8. Sensitive data ----------------------------------------------------
  const all = responses.join('\n')
  const leaks = [SECRET_EMPLOYEE, SECRET_EMAIL, SECRET_RULE, uid, TAG, sa.client_email, cfg.apiKey].filter(v => v && all.includes(v))
  const emails = all.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []
  record(`no employee names, emails, uids, rule text or keys in ${responses.length} monitoring responses`, !leaks.length && !emails.length, leaks.length ? `leaked: ${leaks.length}` : '')
  const ev = await db.collection('errorEvents').get()
  const stored = JSON.stringify(ev.docs.map(d => d.data()))
  record('recorded error events hold no rule text or names', !stored.includes(SECRET_RULE) && !stored.includes(SECRET_EMPLOYEE) && !stored.includes(SECRET_EMAIL))
} catch (err) {
  record('scenario run completed without exceptions', false, err.message)
} finally {
  // ---- Cleanup: synthetic data only, then the final state ------------------
  for (const uid of created.users) {
    await auth.deleteUser(uid).catch(() => {})
    await db.doc(`users/${uid}`).delete().catch(() => {})
  }
  await clearMonitoringState()
  await runCron()
  const final = await status()
  record('final state after cleanup: ok', final.code === 200 && final.body?.level === 'ok', JSON.stringify(final.body?.checks?.filter(c => c.level !== 'ok')))
  mkdirSync(resolve(lt, 'results'), { recursive: true })
  const out = resolve(lt, 'results', `staging-ops-check-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`)
  writeFileSync(out, JSON.stringify({ commit: cfg.commit, appHost: new URL(cfg.appUrl).host, results }, null, 2))
  console.log(`\n${results.length - failures}/${results.length} passed; results: ${out}`)
  process.exit(failures ? 1 : 0)
}
