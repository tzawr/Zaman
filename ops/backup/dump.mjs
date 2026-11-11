#!/usr/bin/env node
// Logical Firestore backup: every document at every depth, with exact typed
// values, to a directory of NDJSON plus a manifest of counts and hashes.
//
//   node ops/backup/dump.mjs --from emulator --out backups/emu-test
//   node ops/backup/dump.mjs --from project:<staging-id> --credentials <sa.json> --out ...
//   node ops/backup/dump.mjs --from project:zaman-ba689 --allow-production-read --out ...
//
// Reading production needs --allow-production-read and is only for approved
// drills or a real incident: the output holds customer data. Keep it on an
// encrypted disk, never in git (backups/ is git-ignored), and delete it after.
// Does not include Firebase Auth users (see ops/BACKUP_AND_RECOVERY.md).

import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { canonical, client, isProduction, parseTarget, tokenFor, walk } from './lib/firestore-rest.mjs'

const { values: a } = parseArgs({ options: {
  from: { type: 'string' }, out: { type: 'string' }, credentials: { type: 'string' },
  'allow-production-read': { type: 'boolean', default: false },
} })
if (!a.from || !a.out) { console.error('usage: dump.mjs --from <target> --out <dir> [--credentials sa.json]'); process.exit(2) }
const source = parseTarget(a.from)
if (isProduction(source) && !a['allow-production-read']) {
  console.error(`refused: ${source.label} is production. Pass --allow-production-read for an approved drill or incident.`)
  process.exit(2)
}

const out = resolve(a.out)
mkdirSync(out, { recursive: true, mode: 0o700 })
const c = client(source, await tokenFor(source, { credentials: a.credentials }))
const file = createWriteStream(resolve(out, 'documents.ndjson'), { mode: 0o600 })
const manifest = { source: source.label, root: c.root, startedAt: new Date().toISOString(), documents: 0, missingParents: 0, bytes: 0, groups: {}, hashes: {} }

for await (const d of walk(c)) {
  // Group by collection path with ids removed: businesses/*/shifts.
  const group = d.path.split('/').filter((_, i) => i % 2 === 0).join('/*/')
  if (d.fields === null) { manifest.missingParents++; continue }
  const line = JSON.stringify({ path: d.path, fields: d.fields })
  file.write(`${line}\n`)
  manifest.documents++
  manifest.bytes += Buffer.byteLength(line)
  manifest.groups[group] = (manifest.groups[group] || 0) + 1
  manifest.hashes[d.path] = createHash('sha256').update(JSON.stringify(canonical(d.fields))).digest('hex').slice(0, 24)
}
await new Promise(r => file.end(r))
manifest.finishedAt = new Date().toISOString()
manifest.digest = createHash('sha256').update(JSON.stringify(Object.entries(manifest.hashes).sort())).digest('hex')
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
console.log(`dumped ${manifest.documents} documents (${(manifest.bytes / 1024).toFixed(1)} KiB) in ${Object.keys(manifest.groups).length} collection groups from ${source.label} -> ${out}`)
console.log(`digest ${manifest.digest.slice(0, 16)}`)
