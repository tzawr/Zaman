#!/usr/bin/env node
// One entry point for every load test. It refuses unsafe targets before
// anything else (loadtest/lib/guard.js, the same check every k6 script repeats
// in its init context), then, for a local run:
//   1. starts provider sinks, so AI and push calls go nowhere paid,
//   2. starts its own copy of scripts/dev-api.js against the emulators, with
//      a clean environment (no inherited keys or service accounts),
//   3. seeds synthetic tenants,
//   4. runs k6, sampling the API process's memory and CPU,
//   5. reads Firestore back to check data integrity,
//   6. writes loadtest/results/<run>-report.md.
//
// Local (emulators must be running, or use the npm scripts that start them):
//   node loadtest/scripts/run.mjs --profile smoke
//   node loadtest/scripts/run.mjs --profile race --script races
//   node loadtest/scripts/run.mjs --profile ratelimit --script ratelimit
//   node loadtest/scripts/run.mjs --profile baseline --save-baseline
//
// Staging: see loadtest/README.md. Needs targets.json entries and, above
// smoke, LOADTEST_APPROVAL=<profile>:<host>:<YYYY-MM-DD>.

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkRun } from '../lib/guard.js'
import { targetsPath } from '../lib/targets.mjs'
import { startSinks } from '../lib/sinks.mjs'
import { renderReport } from './report.mjs'
import { verifyIntegrity } from './verify.mjs'
import { PROFILES } from '../config/profiles.js'

const root = resolve(import.meta.dirname, '../..')
const lt = resolve(root, 'loadtest')
const { values: args } = parseArgs({
  options: {
    profile: { type: 'string', default: 'smoke' },
    script: { type: 'string', default: 'teams-api' },
    tenants: { type: 'string' },
    'no-seed': { type: 'boolean', default: false },
    'save-baseline': { type: 'boolean', default: false },
    thresholds: { type: 'string' },
  },
})

const targets = JSON.parse(readFileSync(targetsPath(lt), 'utf8'))
const pricing = JSON.parse(readFileSync(resolve(lt, 'config/pricing.json'), 'utf8'))
const staging = Boolean(process.env.API_URL && !/127\.0\.0\.1|localhost/.test(process.env.API_URL))
const runId = `${args.profile}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`

// --- 0. Refuse unsafe targets first ----------------------------------------
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
const urls = staging
  ? [process.env.API_URL, process.env.AUTH_URL, process.env.FIRESTORE_URL]
  : ['http://127.0.0.1:3101', `http://${authHost}`, `http://${firestoreHost}`]
const projectId = staging ? process.env.PROJECT_ID : (process.env.GCLOUD_PROJECT || 'demo-hengam')
const guard = checkRun({ urls, profile: args.profile, projectId, targets, approval: process.env.LOADTEST_APPROVAL || '' })
console.log(`guard: ${guard.environment} ${guard.hosts.join(', ')} profile=${args.profile} — allowed`)
if (staging) {
  console.error('Staging runs are driven by k6 directly with the env in loadtest/README.md; this runner only automates local runs.')
  process.exit(2)
}

const resultsDir = resolve(lt, 'results')
mkdirSync(resultsDir, { recursive: true })

async function reachable(url) {
  try { await fetch(url); return true } catch { return false }
}
if (!(await reachable(`http://${firestoreHost}`)) || !(await reachable(`http://${authHost}`))) {
  console.error(`Emulators are not running on ${firestoreHost} / ${authHost}. Use: npm run loadtest:smoke (starts them), or npm run dev:emulators first.`)
  process.exit(2)
}

// --- 1-2. Sinks and an isolated API -----------------------------------------
const sinks = await startSinks()
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_OPTIONS']
const apiEnv = {
  ...Object.fromEntries(SAFE_ENV_KEYS.filter(k => process.env[k]).map(k => [k, process.env[k]])),
  FIRESTORE_EMULATOR_HOST: firestoreHost,
  FIREBASE_AUTH_EMULATOR_HOST: authHost,
  GCLOUD_PROJECT: projectId,
  PORT: '3101',
  APP_URL: 'http://127.0.0.1:3101',
  ...sinks.env,
}
const api = spawn(process.execPath, ['--max-old-space-size=1024', 'scripts/dev-api.js'], { cwd: root, env: apiEnv, stdio: ['ignore', 'pipe', 'pipe'] })
let apiLog = ''
api.stdout.on('data', d => { apiLog += d })
api.stderr.on('data', d => { apiLog += d })
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error(`API did not start:\n${apiLog}`)), 15000)
  api.stdout.on('data', d => { if (String(d).includes('api on')) { clearTimeout(t); ok() } })
})

const cleanup = async () => { api.kill(); await sinks.stop() }
process.on('SIGINT', async () => { await cleanup(); process.exit(130) })

try {
  // --- 3. Seed ----------------------------------------------------------------
  const peak = args.script === 'teams-api' ? PROFILES[args.profile]?.vus || 5 : 25
  const tenants = Number(args.tenants || Math.max(5, Math.ceil(peak / 6) + 2))
  const identities = resolve(lt, '.data/identities.json')
  if (!args['no-seed'] || !existsSync(identities)) {
    execFileSync(process.execPath, [resolve(lt, 'data/seed.mjs'), '--tenants', String(tenants)], {
      cwd: root, stdio: 'inherit', env: { ...apiEnv, PORT: undefined },
    })
  }

  // --- 4. k6, with resource sampling ----------------------------------------
  const baselineFile = resolve(lt, 'config/thresholds.baseline.json')
  // Baseline-derived percentiles only mean something with enough samples:
  // smoke sends a handful per action, so it is held to the sanity bounds.
  const judgedByBaseline = !['smoke', 'baseline'].includes(args.profile)
  const thresholds = args.thresholds ? resolve(args.thresholds) : (existsSync(baselineFile) && judgedByBaseline ? baselineFile : resolve(lt, 'config/thresholds.default.json'))
  const summaryOut = resolve(resultsDir, `${runId}-summary.json`)
  const resources = []
  const sampler = setInterval(() => {
    try {
      const [rss, cpu] = execFileSync('ps', ['-o', 'rss=,%cpu=', '-p', String(api.pid)], { encoding: 'utf8' }).trim().split(/\s+/)
      resources.push({ t: Date.now(), rssMb: Math.round(Number(rss) / 1024), cpu: Number(cpu) })
    } catch { /* process gone */ }
  }, 5000)
  const startedAt = new Date().toISOString()
  const k6 = spawn('k6', ['run', '--quiet', resolve(lt, `k6/${args.script}.js`)], {
    cwd: resolve(lt, 'k6'),
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      PROFILE: args.profile, RUN_ID: runId, SUMMARY_OUT: summaryOut, THRESHOLDS: thresholds,
      API_URL: 'http://127.0.0.1:3101',
      AUTH_URL: `http://${authHost}/identitytoolkit.googleapis.com`,
      FIRESTORE_URL: `http://${firestoreHost}`,
      PROJECT_ID: projectId,
      IDENTITIES: identities,
      LOADTEST_APPROVAL: process.env.LOADTEST_APPROVAL || '',
      K6_NO_USAGE_REPORT: 'true',
    },
  })
  const k6Code = await new Promise(r => k6.on('exit', r))
  clearInterval(sampler)
  const finishedAt = new Date().toISOString()

  // --- 5. Integrity ---------------------------------------------------------
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost
  process.env.GCLOUD_PROJECT = projectId
  const { initializeApp, getApps } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  if (!getApps().length) initializeApp({ projectId })
  const { ACTIONS } = await import('../../api/teams/[action].js')
  const summary = existsSync(summaryOut) ? JSON.parse(readFileSync(summaryOut, 'utf8')) : { metrics: {} }
  const integrity = await verifyIntegrity({ db: getFirestore(), runId, summary: args.script === 'teams-api' ? summary : null, actions: ACTIONS })

  // --- 6. Report ------------------------------------------------------------
  const report = renderReport({ runId, profile: args.profile, script: args.script, environment: guard.environment, summary, integrity, resources, sinks: sinks.counts, pricing, startedAt, finishedAt })
  const reportPath = resolve(resultsDir, `${runId}-report.md`)
  writeFileSync(reportPath, report)
  writeFileSync(resolve(resultsDir, `${runId}-api.log`), apiLog)
  console.log(`\n${report}\nreport: ${reportPath}`)

  if (args['save-baseline']) {
    if (k6Code !== 0 || integrity.findings.length) {
      console.error('Not saving a baseline from a run that failed thresholds or integrity checks.')
    } else {
      const { actionRows } = await import('./report.mjs')
      const base = JSON.parse(readFileSync(resolve(lt, 'config/thresholds.default.json'), 'utf8'))
      for (const r of actionRows(summary)) {
        // Allowed regression vs this baseline: 1.5x at p95, 2x at p99, with a
        // 50 ms floor so tiny local latencies do not make the bar meaningless.
        base[`http_req_duration{action:${r.action}}`] = [`p(95)<${Math.ceil(Math.max(r.p95 * 1.5, r.p95 + 50))}`, `p(99)<${Math.ceil(Math.max(r.p99 * 2, r.p99 + 100))}`]
      }
      base._comment = `Derived from baseline run ${runId}. Regenerate when the environment changes; thresholds from a laptop are meaningless on staging and vice versa.`
      writeFileSync(baselineFile, JSON.stringify(base, null, 2))
      console.log(`baseline thresholds saved to ${baselineFile}`)
    }
  }
  process.exitCode = k6Code === 0 && !integrity.findings.some(f => f.severity === 'P0') ? 0 : 1
} finally {
  await cleanup()
}
process.exit(process.exitCode ?? 0)
