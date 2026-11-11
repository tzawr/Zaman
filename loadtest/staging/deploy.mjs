#!/usr/bin/env node
// Deploys the CURRENT COMMIT to the isolated staging environment:
//   Vercel project "hengam-staging" (Deployment Protection on, preview only)
//   Firebase project in loadtest/.data/staging.json (never production)
//
//   node loadtest/staging/deploy.mjs [--rules]
//
// Safety:
//  - Builds from `git archive HEAD` in a temp directory with its own
//    .vercel link, so the repo's link to the production project "zaman" (and
//    its environment variables) is never used.
//  - Refuses unless the Firebase project is the allowlisted staging one, the
//    service account belongs to it, and the Vercel project is hengam-staging.
//  - Paid and outbound providers are disabled: no Anthropic key, AI and push
//    URLs point at an unroutable address.
//  - Deploys a preview (protected), never production, and refuses to finish
//    if the project's public <name>.vercel.app domain serves anything.
//  --rules also deploys firestore.rules and indexes to the staging project.

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PRODUCTION_FIREBASE_PROJECTS } from '../lib/guard.js'

const root = resolve(import.meta.dirname, '../..')
const cfgPath = resolve(root, 'loadtest/.data/staging.json')
// Real hosts go to the git-ignored copy, never the committed template.
const targetsPath = resolve(root, 'loadtest/.data/targets.json')
if (!existsSync(targetsPath)) copyFileSync(resolve(root, 'loadtest/config/targets.json'), targetsPath)
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
const targets = JSON.parse(readFileSync(targetsPath, 'utf8'))

const fail = (msg) => { console.error(`staging deploy refused: ${msg}`); process.exit(2) }
if (PRODUCTION_FIREBASE_PROJECTS.includes(cfg.projectId)) fail('that is the production Firebase project')
if (!targets.staging.firebaseProjects.includes(cfg.projectId)) fail(`${cfg.projectId} is not in targets.json staging.firebaseProjects`)
if (cfg.vercelProject !== 'hengam-staging' || !cfg.vercelProjectId) fail('Vercel project must be hengam-staging')
if (!cfg.serviceAccountPath) fail('serviceAccountPath is not set in loadtest/.data/staging.json')
const saJson = readFileSync(cfg.serviceAccountPath, 'utf8')
const sa = JSON.parse(saJson)
if (sa.project_id !== cfg.projectId) fail(`service account is for ${sa.project_id}, not ${cfg.projectId}`)

// Vercel's view of the project must match too, before anything is written.
const vercel = (args, opts = {}) => execFileSync('vercel', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
const project = JSON.parse(vercel(['api', `/v9/projects/${cfg.vercelProjectId}`, '--raw']).replace(/^[^{]*/, ''))
if (project.name !== 'hengam-staging') fail(`Vercel project ${cfg.vercelProjectId} is "${project.name}"`)
if (!project.ssoProtection) fail('Deployment Protection is off on hengam-staging')

if (process.argv.includes('--rules')) {
  execFileSync('firebase', ['deploy', '--only', 'firestore:rules,firestore:indexes', '--project', cfg.projectId, '--non-interactive'], { cwd: root, stdio: 'inherit' })
}

// Environment for the staging project (preview target only).
const web = cfg.web
const env = {
  VITE_FIREBASE_API_KEY: web.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: web.authDomain,
  VITE_FIREBASE_PROJECT_ID: web.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: web.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: web.messagingSenderId,
  VITE_FIREBASE_APP_ID: web.appId,
  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: Buffer.from(saJson).toString('base64'),
  // Paid AI disabled: a non-key and an address nothing listens on.
  ANTHROPIC_API_KEY: 'staging-disabled-not-a-key',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  EXPO_PUSH_URL: 'http://127.0.0.1:9/push/send',
  APP_URL: 'https://hengam-staging.invalid',
  ADMIN_UIDS: '',
  TEAMS_ALLOWED_ORIGINS: '',
  CRON_SECRET: cfg.cronSecret || (cfg.cronSecret = randomBytes(24).toString('hex')),
  // Staging's own token for /api/ops/status (never production's).
  OPS_STATUS_TOKEN: cfg.opsStatusToken || (cfg.opsStatusToken = randomBytes(24).toString('hex')),
  // Logs which IP headers reached the code (xff-probe.mjs reads them).
  LOG_CLIENT_IP_HEADERS: '1',
}
const secret = new Set(['FIREBASE_SERVICE_ACCOUNT_KEY_BASE64', 'CRON_SECRET', 'OPS_STATUS_TOKEN'])
const work = mkdtempSync(join(tmpdir(), 'hengam-staging-'))
// One variable per call: `vercel api --input` takes an object, not an array.
// Values travel in a temp file, never on a command line.
for (const [key, value] of Object.entries(env)) {
  const file = join(work, `env-${key}.json`)
  writeFileSync(file, JSON.stringify({ key, value: value || ' ', type: secret.has(key) ? 'encrypted' : 'plain', target: ['preview'] }), { mode: 0o600 })
  vercel(['api', `/v10/projects/${cfg.vercelProjectId}/env?upsert=true`, '-X', 'POST', '--input', file, '--silent'])
  rmSync(file)
}
console.log(`staging env set: ${Object.keys(env).join(', ')}`)

// Build from the committed tree only, linked to hengam-staging.
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const build = join(work, 'src')
mkdirSync(build)
execFileSync('bash', ['-c', `git -C "${root}" archive HEAD | tar -x -C "${build}"`])
mkdirSync(join(build, '.vercel'))
writeFileSync(join(build, '.vercel/project.json'), JSON.stringify({ projectId: cfg.vercelProjectId, orgId: project.accountId }))
console.log(`deploying ${head} to hengam-staging (preview, protected)...`)
// Always an explicit preview: a new project's first plain `vercel deploy`
// goes to production, and a production deployment gets the project's
// <name>.vercel.app domain, which Standard Protection leaves PUBLIC.
const run = spawnSync('vercel', ['deploy', '--yes', '--target', 'preview'], { cwd: build, encoding: 'utf8' })
const out = `${run.stdout}\n${run.stderr}`
if (run.status !== 0) fail(`vercel deploy failed:\n${out}`)
const url = out.split('\n').map(l => l.trim()).filter(l => /^https:\/\/[^\s]+\.vercel\.app$/.test(l)).pop()
  || out.match(/https:\/\/hengam-staging-[a-z0-9-]+\.vercel\.app/g)?.pop()
if (!url) fail(`no deployment URL in output:\n${out}`)

// The project's public production domain must not serve anything.
const publicDomain = await fetch('https://hengam-staging.vercel.app/', { redirect: 'manual' })
if (publicDomain.status === 200) fail('https://hengam-staging.vercel.app answers 200: a public production alias exists. Remove it (vercel alias rm) before testing.')

// Protection must hold: without the bypass, the deployment refuses us.
const plain = await fetch(`${url}/api/teams/health`, { redirect: 'manual' })
if (![401, 403, 302, 307].includes(plain.status)) fail(`deployment answered ${plain.status} without the bypass: protection is not on`)
const health = await fetch(`${url}/api/teams/health`, { headers: { 'x-vercel-protection-bypass': cfg.bypassSecret } })

cfg.appUrl = url
cfg.commit = head
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
const host = new URL(url).host
targets.staging.hosts = [...new Set([...targets.staging.hosts.filter(h => !/vercel\.app$/.test(h)), host, 'identitytoolkit.googleapis.com', 'firestore.googleapis.com'])]
writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`)
console.log(`deployed ${head} -> ${url}`)
console.log(`without bypass: ${plain.status} (protected); health with bypass: ${health.status} ${await health.text()}`)
