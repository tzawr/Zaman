#!/usr/bin/env node
// The last step of a recovery: copy verified documents from a restored copy
// (a restored/cloned database, or a logical backup) back into the live
// database, for chosen paths only.
//
//   # 1. See what would change (default: dry run, writes nothing)
//   node ops/backup/copy-back.mjs --from project:zaman-ba689/restore-2026-11-20 \
//        --to project:zaman-ba689 --paths employees,schedules/abc --allow-production-read
//   # 2. Apply, after review, during an incident with a ticket/id
//   node ops/backup/copy-back.mjs ... --apply --incident INC-7 --confirm-target project:zaman-ba689
//
// Safety:
//  - Dry run unless --apply. Prints creates / overwrites / unchanged per path.
//  - Only documents under --paths (comma-separated collection or document
//    path prefixes). Never deletes anything in the target.
//  - Writing to production needs --apply, --incident, and --confirm-target
//    repeating the target exactly, and first dumps the target's current
//    versions of every affected document to backups/pre-copyback-<incident>-<time>/
//    so the copy-back itself can be undone.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { canonical, client, isProduction, parseTarget, rewriteRefs, tokenFor, walk } from './lib/firestore-rest.mjs'

const { values: a } = parseArgs({ options: {
  from: { type: 'string' }, to: { type: 'string' }, paths: { type: 'string' },
  'from-credentials': { type: 'string' }, credentials: { type: 'string' },
  apply: { type: 'boolean', default: false }, incident: { type: 'string' }, 'confirm-target': { type: 'string' },
  'allow-production-read': { type: 'boolean', default: false },
} })
if (!a.from || !a.to || !a.paths) { console.error('usage: copy-back.mjs --from <db|backup dir> --to <target> --paths p1,p2 [--apply ...]'); process.exit(2) }
const prefixes = a.paths.split(',').map(p => p.trim().replace(/^\/|\/$/g, '')).filter(Boolean)
const inScope = (path) => prefixes.some(p => path === p || path.startsWith(`${p}/`))
const target = parseTarget(a.to)
const prod = isProduction(target)
if (prod && !a['allow-production-read']) { console.error('target is production: pass --allow-production-read (and --apply/--incident/--confirm-target to write)'); process.exit(2) }
if (a.apply && prod && (!a.incident || a['confirm-target'] !== a.to)) {
  console.error(`refused: writing to production needs --incident <id> and --confirm-target ${a.to}`)
  process.exit(2)
}

// Source documents in scope.
const source = new Map()
let sourceRoot
if (existsSync(resolve(a.from, 'manifest.json'))) {
  sourceRoot = JSON.parse(readFileSync(resolve(a.from, 'manifest.json'), 'utf8')).root
  for await (const line of createInterface({ input: createReadStream(resolve(a.from, 'documents.ndjson')) })) {
    if (!line.trim()) continue
    const d = JSON.parse(line)
    if (inScope(d.path)) source.set(d.path, d.fields)
  }
} else {
  const s = parseTarget(a.from)
  if (isProduction(s) && !a['allow-production-read']) { console.error('source is in production: pass --allow-production-read'); process.exit(2) }
  const sc = client(s, await tokenFor(s, { credentials: a['from-credentials'] }))
  sourceRoot = sc.root
  for await (const d of walk(sc)) if (d.fields && inScope(d.path)) source.set(d.path, d.fields)
}

const tc = client(target, await tokenFor(target, { credentials: a.credentials }))
const current = new Map()
for await (const d of walk(tc)) if (d.fields && inScope(d.path)) current.set(d.path, d.fields)

const h = (f) => createHash('sha256').update(JSON.stringify(canonical(f))).digest('hex')
const plan = { create: [], overwrite: [], unchanged: [], onlyInTarget: [] }
for (const [path, fields] of source) {
  if (!current.has(path)) plan.create.push(path)
  else if (h(current.get(path)) !== h(fields)) plan.overwrite.push(path)
  else plan.unchanged.push(path)
}
for (const path of current.keys()) if (!source.has(path)) plan.onlyInTarget.push(path)
console.log(`scope: ${prefixes.join(', ')} | source ${source.size} docs -> target ${target.label}`)
console.log(`create ${plan.create.length}, overwrite ${plan.overwrite.length}, unchanged ${plan.unchanged.length}, only in target (left alone) ${plan.onlyInTarget.length}`)
for (const k of ['create', 'overwrite']) for (const p of plan[k].slice(0, 15)) console.log(`  ${k}: ${p}`)
if (!a.apply) { console.log('dry run: nothing written. Re-run with --apply to write.'); process.exit(0) }

// Undo point: the target's current version of everything about to change.
const touched = [...plan.overwrite]
const undoDir = resolve('backups', `pre-copyback-${a.incident || 'local'}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(undoDir, { recursive: true, mode: 0o700 })
writeFileSync(resolve(undoDir, 'documents.ndjson'), touched.map(p => JSON.stringify({ path: p, fields: current.get(p) })).join('\n') + (touched.length ? '\n' : ''), { mode: 0o600 })
writeFileSync(resolve(undoDir, 'manifest.json'), JSON.stringify({ source: target.label, root: tc.root, documents: touched.length, purpose: `undo for copy-back ${a.incident || ''}`, created: plan.create, hashes: Object.fromEntries(touched.map(p => [p, h(current.get(p)).slice(0, 24)])) }, null, 2), { mode: 0o600 })
console.log(`undo point: ${undoDir} (${touched.length} prior versions; ${plan.create.length} created docs listed for removal)`)

const writes = [...plan.create, ...plan.overwrite].map(p => ({ update: { name: `${tc.root}/${p}`, fields: rewriteRefs(source.get(p), `${sourceRoot}/`, `${tc.root}/`) } }))
for (let i = 0; i < writes.length; i += 400) await tc.commit(writes.slice(i, i + 400))

// Verify what is now stored.
let ok = 0
for await (const d of walk(tc)) if (d.fields && source.has(d.path) && h(d.fields) === h(rewriteRefs(source.get(d.path), `${sourceRoot}/`, `${tc.root}/`))) ok++
console.log(`applied ${writes.length} writes; verified ${ok}/${source.size} in-scope documents now match the source`)
process.exit(ok === source.size ? 0 : 1)
