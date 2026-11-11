#!/usr/bin/env node
// k6 against the staging deployment, then the same integrity read-back and
// report as local runs, reading the staging project with its service account.
//
//   node loadtest/staging/run.mjs --profile smoke
//   node loadtest/staging/run.mjs --profile race --script races
//   node loadtest/staging/run.mjs --profile ratelimit --script ratelimit
//
// Heavier profiles need LOADTEST_APPROVAL=<profile>:<staging host>:<date>
// (checked by the guard inside k6 as well as here).

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkRun } from '../lib/guard.js'
import { targetsPath } from '../lib/targets.mjs'
import { renderReport } from '../scripts/report.mjs'
import { verifyIntegrity } from '../scripts/verify.mjs'

const lt = resolve(import.meta.dirname, '..')
const { values: args } = parseArgs({ options: { profile: { type: 'string', default: 'smoke' }, script: { type: 'string', default: 'teams-api' } } })
const cfg = JSON.parse(readFileSync(resolve(lt, '.data/staging.json'), 'utf8'))
const targets = JSON.parse(readFileSync(targetsPath(lt), 'utf8'))
const pricing = JSON.parse(readFileSync(resolve(lt, 'config/pricing.json'), 'utf8'))
const AUTH_URL = 'https://identitytoolkit.googleapis.com'
const FIRESTORE_URL = 'https://firestore.googleapis.com'
const guard = checkRun({ urls: [cfg.appUrl, AUTH_URL, FIRESTORE_URL], profile: args.profile, projectId: cfg.projectId, targets, approval: process.env.LOADTEST_APPROVAL || '' })
console.log(`guard: ${guard.environment} ${guard.hosts.join(', ')} profile=${args.profile} — allowed`)

const runId = `staging-${args.profile}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
const results = resolve(lt, 'results')
mkdirSync(results, { recursive: true })
const summaryOut = resolve(results, `${runId}-summary.json`)
const identities = resolve(lt, '.data/staging-identities.json')
if (!existsSync(identities)) throw new Error('seed staging first: node loadtest/data/seed.mjs --staging --out loadtest/.data/staging-identities.json')

const startedAt = new Date().toISOString()
const k6 = spawn('k6', ['run', '--quiet', resolve(lt, `k6/${args.script}.js`)], {
  cwd: resolve(lt, 'k6'),
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME, K6_NO_USAGE_REPORT: 'true',
    PROFILE: args.profile, RUN_ID: runId, SUMMARY_OUT: summaryOut,
    THRESHOLDS: resolve(lt, 'config/thresholds.default.json'),
    API_URL: cfg.appUrl, AUTH_URL: `${AUTH_URL}`, FIRESTORE_URL, FIREBASE_API_KEY: cfg.apiKey,
    PROJECT_ID: cfg.projectId, IDENTITIES: identities, VERCEL_BYPASS: cfg.bypassSecret,
    LOADTEST_APPROVAL: process.env.LOADTEST_APPROVAL || '',
  },
})
const code = await new Promise(r => k6.on('exit', r))

const sa = JSON.parse(readFileSync(cfg.serviceAccountPath, 'utf8'))
if (sa.project_id !== cfg.projectId) throw new Error('service account is not for the staging project')
const { initializeApp, cert } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
initializeApp({ credential: cert(sa) })
const { ACTIONS } = await import('../../api/teams/[action].js')
const summary = existsSync(summaryOut) ? JSON.parse(readFileSync(summaryOut, 'utf8')) : { metrics: {} }
const integrity = await verifyIntegrity({ db: getFirestore(), runId, summary: args.script === 'teams-api' ? summary : null, actions: ACTIONS })
const report = renderReport({ runId, profile: args.profile, script: args.script, environment: `staging (${new URL(cfg.appUrl).host}, ${cfg.projectId}, commit ${cfg.commit})`, summary, integrity, resources: [], sinks: null, pricing, startedAt, finishedAt: new Date().toISOString() })
writeFileSync(resolve(results, `${runId}-report.md`), report)
console.log(`\n${report}`)
process.exit(code === 0 && !integrity.findings.some(f => f.severity === 'P0') ? 0 : 1)
