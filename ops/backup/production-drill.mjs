#!/usr/bin/env node
// Production restore drill. NEEDS APPROVAL each time it is run: it creates
// and then deletes a temporary database in the production project.
//
//   node ops/backup/production-drill.mjs                 # plan only (default)
//   node ops/backup/production-drill.mjs --run           # do it
//   node ops/backup/production-drill.mjs --run --from-backup <backup resource name>
//
// 1. Copies production's (default) database into a NEW database
//    drill-<yyyymmdd-hhmm>: a clone at a whole-minute snapshot (works within
//    the version window, 1 h without PITR, 7 days with it), or a restore of a
//    scheduled backup with --from-backup. Production is never written.
// 2. Compares every document in the copy with production AS OF THE SNAPSHOT
//    TIME (exact, even while production keeps changing).
// 3. Keeps the drill database (no Security Rules, so clients cannot reach it;
//    only admin credentials can) until cleanup is approved: --delete.
// Records the result in backups/drills/ (no customer data, counts only).

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

// Keeps the drill database by default: delete it only after the results are
// recorded and cleanup is approved (--delete). Clones inherit delete
// protection, so deletion first turns it off on the drill database.
const { values: a } = parseArgs({ options: { run: { type: 'boolean', default: false }, 'from-backup': { type: 'string' }, delete: { type: 'boolean', default: false } } })
const PROJECT = 'zaman-ba689'
const now = new Date()
const minute = new Date(Math.floor((now.getTime() - 2 * 60_000) / 60_000) * 60_000)
const snapshot = minute.toISOString().replace('.000Z', 'Z')
const id = `drill-${minute.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2')}`
const fb = (args) => execFileSync('firebase', [...args, '--project', PROJECT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const steps = a['from-backup']
  ? [`firebase firestore:databases:restore --backup ${a['from-backup']} --database ${id} --project ${PROJECT}`]
  : [`firebase firestore:databases:clone "projects/${PROJECT}/databases/(default)" "projects/${PROJECT}/databases/${id}" --snapshot-time ${snapshot} --project ${PROJECT}`]
steps.push(
  `node ops/backup/compare.mjs --expected project:${PROJECT} --expected-read-time ${a['from-backup'] ? '<backup snapshot time>' : snapshot} --actual project:${PROJECT}/${id} --allow-production-read`,
  `firebase firestore:databases:update ${id} --delete-protection DISABLED --project ${PROJECT}   # clones inherit delete protection`,
  `firebase firestore:databases:delete ${id} --force --project ${PROJECT}   # only after results are recorded and approved`,
)
console.log(`Production restore drill (${a.run ? 'RUN' : 'plan only'})\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`)
if (!a.run) process.exit(0)
if (a['from-backup']) { console.error('restore-from-backup drills: run the steps above by hand; the compare needs the backup\'s snapshot time from `firebase firestore:backups:get`.'); process.exit(2) }

const t0 = Date.now()
fb(['firestore:databases:clone', `projects/${PROJECT}/databases/(default)`, `projects/${PROJECT}/databases/${id}`, '--snapshot-time', snapshot])
// The clone is a long-running operation; wait until the database answers.
let ready = false
for (let i = 0; i < 120 && !ready; i++) {
  const r = spawnSync('firebase', ['firestore:databases:get', id, '--project', PROJECT, '--json'], { encoding: 'utf8' })
  ready = r.status === 0 && /"state"\s*:\s*"?(READY|ACTIVE)?/.test(r.stdout) && !/CREATING/.test(r.stdout)
  if (!ready) await new Promise(res => setTimeout(res, 10_000))
}
const cloneSeconds = Math.round((Date.now() - t0) / 1000)
const cmp = spawnSync(process.execPath, ['ops/backup/compare.mjs', '--expected', `project:${PROJECT}`, '--expected-read-time', snapshot, '--actual', `project:${PROJECT}/${id}`, '--allow-production-read'], { encoding: 'utf8' })
console.log(cmp.stdout)
if (a.delete) {
  fb(['firestore:databases:update', id, '--delete-protection', 'DISABLED'])
  fb(['firestore:databases:delete', id, '--force'])
}
const record = { project: PROJECT, drillDatabase: id, snapshot, cloneSeconds, totalSeconds: Math.round((Date.now() - t0) / 1000), compare: cmp.stdout.trim().split('\n'), passed: cmp.status === 0, deleted: a.delete, at: new Date().toISOString() }
mkdirSync(resolve('backups/drills'), { recursive: true })
writeFileSync(resolve('backups/drills', `${id}.json`), JSON.stringify(record, null, 2))
console.log(`drill ${record.passed ? 'PASSED' : 'FAILED'}: clone ${cloneSeconds}s, total ${record.totalSeconds}s; record backups/drills/${id}.json`)
process.exit(record.passed ? 0 : 1)
