#!/usr/bin/env node
// Restores a logical backup (dump.mjs output) into an ISOLATED target.
//
//   node ops/backup/load.mjs --dump backups/x --into emulator
//   node ops/backup/load.mjs --dump backups/x --into project:<staging-id>/<new-db> --credentials <sa.json>
//
// Never into production: any target in the production project is refused,
// whatever the database id. Production is recovered with the managed tools
// (restore or clone into a NEW database, then a reviewed copy-back); see
// ops/BACKUP_AND_RECOVERY.md. Refuses a target that already holds documents
// unless --into-nonempty is given, so a restore never mixes with live data.

import { createReadStream, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { client, isProduction, parseTarget, rewriteRefs, tokenFor, walk } from './lib/firestore-rest.mjs'

const { values: a } = parseArgs({ options: {
  dump: { type: 'string' }, into: { type: 'string' }, credentials: { type: 'string' },
  'into-nonempty': { type: 'boolean', default: false },
} })
if (!a.dump || !a.into) { console.error('usage: load.mjs --dump <dir> --into <target> [--credentials sa.json]'); process.exit(2) }
const target = parseTarget(a.into)
if (isProduction(target)) {
  console.error(`refused: ${target.label} is in the production project. Restore into an isolated project or the emulator.`)
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(resolve(a.dump, 'manifest.json'), 'utf8'))
const c = client(target, await tokenFor(target, { credentials: a.credentials }))
if (!a['into-nonempty']) {
  for await (const _ of walk(c)) {
    console.error(`refused: ${target.label} already holds documents. Use an empty target (or --into-nonempty for a deliberate merge).`)
    process.exit(2)
  }
}

const fromRoot = `${manifest.root}/`
const toRoot = `${c.root}/`
let batch = []
let written = 0
const flush = async () => {
  if (!batch.length) return
  await c.commit(batch)
  written += batch.length
  batch = []
}
const lines = createInterface({ input: createReadStream(resolve(a.dump, 'documents.ndjson')) })
for await (const line of lines) {
  if (!line.trim()) continue
  const { path, fields } = JSON.parse(line)
  batch.push({ update: { name: `${c.root}/${path}`, fields: rewriteRefs(fields, fromRoot, toRoot) } })
  if (batch.length === 400) await flush()
}
await flush()
console.log(`restored ${written} of ${manifest.documents} documents from ${manifest.source} into ${target.label}`)
if (written !== manifest.documents) process.exit(1)
