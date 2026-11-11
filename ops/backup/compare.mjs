#!/usr/bin/env node
// Proves a restore: compares a backup manifest (or a live database) with
// another database, document by document, by canonical hash of every field.
//
//   node ops/backup/compare.mjs --expected backups/x --actual emulator
//   node ops/backup/compare.mjs --expected project:zaman-ba689 --actual project:zaman-ba689/drill-x --allow-production-read
//
// Read-only on both sides. Exit 0 only when every document matches exactly.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { canonical, client, isProduction, parseTarget, tokenFor, walk } from './lib/firestore-rest.mjs'

const { values: a } = parseArgs({ options: {
  expected: { type: 'string' }, actual: { type: 'string' },
  credentials: { type: 'string' }, 'expected-credentials': { type: 'string' },
  'allow-production-read': { type: 'boolean', default: false },
  // Read the EXPECTED database as of this time (e.g. a clone's snapshot time).
  'expected-read-time': { type: 'string' },
  // Write per-collection counts, value-type histograms and sizes for both
  // sides (no document contents) to this JSON file.
  report: { type: 'string' },
} })

async function hashesOf(spec, credentials, readTime) {
  if (existsSync(resolve(spec, 'manifest.json'))) {
    const m = JSON.parse(readFileSync(resolve(spec, 'manifest.json'), 'utf8'))
    return { label: `backup ${spec} (${m.source})`, hashes: m.hashes }
  }
  const t = parseTarget(spec)
  if (isProduction(t) && !a['allow-production-read']) throw new Error(`${t.label} is production; pass --allow-production-read for an approved drill`)
  const c = client(t, await tokenFor(t, { credentials }), { readTime })
  const hashes = {}
  const stats = { groups: {}, types: {}, fields: 0, logicalBytes: 0, missingParents: 0, maxDepth: 0 }
  // Counts every typed value at every depth (maps and arrays included).
  const tally = (v) => {
    const type = Object.keys(v || {})[0] || 'unknown'
    stats.types[type] = (stats.types[type] || 0) + 1
    if (type === 'mapValue') for (const x of Object.values(v.mapValue.fields || {})) tally(x)
    if (type === 'arrayValue') for (const x of v.arrayValue.values || []) tally(x)
  }
  for await (const d of walk(c)) {
    if (d.fields === null) { stats.missingParents++; continue }
    hashes[d.path] = createHash('sha256').update(JSON.stringify(canonical(d.fields))).digest('hex').slice(0, 24)
    const group = d.path.split('/').filter((_, i) => i % 2 === 0).join('/*/')
    stats.groups[group] = (stats.groups[group] || 0) + 1
    stats.maxDepth = Math.max(stats.maxDepth, d.path.split('/').length / 2)
    stats.fields += Object.keys(d.fields).length
    stats.logicalBytes += Buffer.byteLength(JSON.stringify(d.fields)) + Buffer.byteLength(d.path)
    for (const v of Object.values(d.fields)) tally(v)
  }
  return { label: readTime ? `${t.label} @ ${readTime}` : t.label, hashes, stats }
}

const exp = await hashesOf(a.expected, a['expected-credentials'], a['expected-read-time'])
const act = await hashesOf(a.actual, a.credentials)
const missing = Object.keys(exp.hashes).filter(p => !(p in act.hashes))
const extra = Object.keys(act.hashes).filter(p => !(p in exp.hashes))
const changed = Object.keys(exp.hashes).filter(p => p in act.hashes && act.hashes[p] !== exp.hashes[p])
const n = Object.keys(exp.hashes).length
console.log(`expected: ${exp.label}: ${n} documents`)
console.log(`actual:   ${act.label}: ${Object.keys(act.hashes).length} documents`)
console.log(`identical: ${n - missing.length - changed.length}; missing: ${missing.length}; changed: ${changed.length}; extra: ${extra.length}`)
for (const [k, list] of Object.entries({ missing, changed, extra })) for (const p of list.slice(0, 10)) console.log(`  ${k}: ${p}`)
const ok = !missing.length && !changed.length && !extra.length
if (a.report) {
  writeFileSync(a.report, JSON.stringify({
    expected: { label: exp.label, documents: n, ...exp.stats },
    actual: { label: act.label, documents: Object.keys(act.hashes).length, ...act.stats },
    identical: n - missing.length - changed.length, missing, changed, extra, ok,
  }, null, 2), { mode: 0o600 })
  console.log(`report: ${a.report}`)
}
console.log(ok ? 'RESULT: exact match' : 'RESULT: MISMATCH')
process.exit(ok ? 0 : 1)
