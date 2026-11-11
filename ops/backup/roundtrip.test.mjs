// Backup → restore → verify, end to end on the emulator, with the same
// scripts used for real recoveries:
//   firebase emulators:exec --only firestore --project demo-hengam 'node --test ops/backup/roundtrip.test.mjs'
//
// The data is realistic (seeded Teams workplaces plus Hengam web documents)
// and includes every awkward Firestore value: integer vs double, timestamps
// with microseconds, references, bytes, geopoints, nulls, nested arrays and
// maps, and a "missing" parent that only holds a subcollection.

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'
const DOCS = `http://${host}/v1/projects/demo-hengam/databases/(default)/documents`
const node = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, FIRESTORE_EMULATOR_HOST: host }, ...opts })
const dir = mkdtempSync(join(tmpdir(), 'hengam-backup-'))
const restoreDb = `restore-${Date.now()}`

async function put(path, fields) {
  const r = await fetch(`${DOCS}/${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) })
  assert.equal(r.status, 200, await r.text())
}

before(async () => {
  await fetch(`${DOCS}`, { method: 'DELETE' }).catch(() => {})
  execFileSync(process.execPath, ['loadtest/data/seed.mjs', '--tenants', '3', '--staff', '4', '--out', join(dir, 'ids.json')], {
    cwd: root, env: { ...process.env, FIRESTORE_EMULATOR_HOST: host, FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-hengam' }, stdio: 'pipe',
  })
  await put('users/mgr1', { email: { stringValue: 'm@example.test' }, tier: { stringValue: 'free' }, onboarded: { booleanValue: true } })
  await put('employees/e1', {
    userId: { stringValue: 'mgr1' }, name: { stringValue: 'Ana Lima' },
    targetHours: { integerValue: '30' }, ratio: { doubleValue: 30.0 }, half: { doubleValue: 0.5 },
    createdAt: { timestampValue: '2026-11-11T04:21:35.819201Z' },
    manager: { referenceValue: 'projects/demo-hengam/databases/(default)/documents/users/mgr1' },
    photo: { bytesValue: Buffer.from('not really a jpeg').toString('base64') },
    place: { geoPointValue: { latitude: 33.68, longitude: -117.82 } },
    nothing: { nullValue: null },
    availability: { mapValue: { fields: { monday: { arrayValue: { values: [{ mapValue: { fields: { start: { stringValue: '09:00' }, end: { stringValue: '17:00' } } } }] } } } } },
  })
  await put('schedules/s1', { userId: { stringValue: 'mgr1' }, data: { mapValue: { fields: { days: { mapValue: { fields: {} } } } } }, empty: { arrayValue: {} } })
  // A parent that does not exist, holding a subcollection.
  await put('ghosts/nobody/notes/n1', { text: { stringValue: 'only child' } })
})

test('production is refused by dump (without the flag) and always by load', () => {
  const d = node(['ops/backup/dump.mjs', '--from', 'project:zaman-ba689', '--out', join(dir, 'never')])
  assert.equal(d.status, 2); assert.match(d.stderr, /production/)
  for (const db of ['', '/restore-x', '/(default)']) {
    const l = node(['ops/backup/load.mjs', '--dump', join(dir, 'never'), '--into', `project:zaman-ba689${db}`])
    assert.equal(l.status, 2, db); assert.match(l.stderr, /production/)
  }
})

test('dump captures every document, including subcollection-only parents', () => {
  const r = node(['ops/backup/dump.mjs', '--from', 'emulator', '--out', join(dir, 'b1')])
  assert.equal(r.status, 0, r.stderr)
  const m = JSON.parse(readFileSync(join(dir, 'b1/manifest.json'), 'utf8'))
  assert.ok(m.documents > 50, `only ${m.documents} documents`)
  assert.ok(m.groups['businesses/*/shifts'] > 0)
  assert.ok(m.hashes['ghosts/nobody/notes/n1'], 'subcollection under a missing parent')
  assert.ok(!('ghosts/nobody' in m.hashes), 'the missing parent itself is not invented')
})

test('restore into an empty, isolated database reproduces every document exactly', () => {
  const l = node(['ops/backup/load.mjs', '--dump', join(dir, 'b1'), '--into', `emulator:demo-hengam/${restoreDb}`])
  assert.equal(l.status, 0, l.stderr + l.stdout)
  const c = node(['ops/backup/compare.mjs', '--expected', join(dir, 'b1'), '--actual', `emulator:demo-hengam/${restoreDb}`])
  assert.equal(c.status, 0, c.stdout + c.stderr)
  assert.match(c.stdout, /exact match/)
})

test('typed values survive: integer vs double, timestamp precision, bytes, geopoint, null; references point at the copy', async () => {
  const r = await fetch(`http://${host}/v1/projects/demo-hengam/databases/${restoreDb}/documents/employees/e1`, { headers: { Authorization: 'Bearer owner' } })
  const f = (await r.json()).fields
  assert.deepEqual(f.targetHours, { integerValue: '30' })
  assert.deepEqual(f.ratio, { doubleValue: 30 })
  assert.equal(f.createdAt.timestampValue, '2026-11-11T04:21:35.819201Z')
  assert.equal(Buffer.from(f.photo.bytesValue, 'base64').toString(), 'not really a jpeg')
  assert.deepEqual(f.place, { geoPointValue: { latitude: 33.68, longitude: -117.82 } })
  assert.deepEqual(f.nothing, { nullValue: null })
  assert.equal(f.manager.referenceValue, `projects/demo-hengam/databases/${restoreDb}/documents/users/mgr1`)
})

test('the live source is untouched, and a second restore into the same database is refused', () => {
  const c = node(['ops/backup/compare.mjs', '--expected', join(dir, 'b1'), '--actual', 'emulator'])
  assert.equal(c.status, 0, c.stdout)
  const again = node(['ops/backup/load.mjs', '--dump', join(dir, 'b1'), '--into', `emulator:demo-hengam/${restoreDb}`])
  assert.equal(again.status, 2); assert.match(again.stderr, /already holds documents/)
})

test('compare catches a changed, a missing and an extra document', async () => {
  const base = `http://${host}/v1/projects/demo-hengam/databases/${restoreDb}/documents`
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }
  await fetch(`${base}/employees/e1?updateMask.fieldPaths=name`, { method: 'PATCH', headers: h, body: JSON.stringify({ fields: { name: { stringValue: 'Tampered' } } }) })
  await fetch(`${base}/schedules/s1`, { method: 'DELETE', headers: h })
  await fetch(`${base}/employees/intruder`, { method: 'PATCH', headers: h, body: JSON.stringify({ fields: { x: { stringValue: 'y' } } }) })
  const c = node(['ops/backup/compare.mjs', '--expected', join(dir, 'b1'), '--actual', `emulator:demo-hengam/${restoreDb}`])
  assert.equal(c.status, 1)
  assert.match(c.stdout, /missing: 1; changed: 1; extra: 1/)
})

test('copy-back: dry run writes nothing; apply restores only the chosen paths, with an undo point', async () => {
  const live = `http://${host}/v1/projects/demo-hengam/databases/(default)/documents`
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }
  // The incident: an employee is corrupted and a schedule deleted in the live database.
  await fetch(`${live}/employees/e1?updateMask.fieldPaths=name`, { method: 'PATCH', headers: h, body: JSON.stringify({ fields: { name: { stringValue: 'CORRUPTED' } } }) })
  await fetch(`${live}/schedules/s1`, { method: 'DELETE', headers: h })
  await fetch(`${live}/users/mgr1?updateMask.fieldPaths=note`, { method: 'PATCH', headers: h, body: JSON.stringify({ fields: { note: { stringValue: 'legit change after backup' } } }) })

  const dry = node(['ops/backup/copy-back.mjs', '--from', join(dir, 'b1'), '--to', 'emulator', '--paths', 'employees,schedules'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /create 1, overwrite 1/)
  assert.match(dry.stdout, /dry run: nothing written/)
  const still = await (await fetch(`${live}/employees/e1`, { headers: h })).json()
  assert.equal(still.fields.name.stringValue, 'CORRUPTED')

  const run = node([resolve(root, 'ops/backup/copy-back.mjs'), '--from', join(dir, 'b1'), '--to', 'emulator', '--paths', 'employees,schedules', '--apply', '--incident', 'TEST-1'], { cwd: dir })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /verified (\d+)\/\1 in-scope/)
  const fixed = await (await fetch(`${live}/employees/e1`, { headers: h })).json()
  assert.equal(fixed.fields.name.stringValue, 'Ana Lima')
  assert.equal((await fetch(`${live}/schedules/s1`, { headers: h })).status, 200)
  // Out of scope: the legitimate later change to users/mgr1 is kept.
  const user = await (await fetch(`${live}/users/mgr1`, { headers: h })).json()
  assert.equal(user.fields.note.stringValue, 'legit change after backup')
  assert.match(run.stdout, /undo point: .*pre-copyback-TEST-1/)
})

test('copy-back into production needs an incident id and the target typed back', () => {
  const r = node(['ops/backup/copy-back.mjs', '--from', join(dir, 'b1'), '--to', 'project:zaman-ba689', '--paths', 'employees', '--allow-production-read', '--apply'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--incident <id> and --confirm-target project:zaman-ba689/)
  const r2 = node(['ops/backup/copy-back.mjs', '--from', join(dir, 'b1'), '--to', 'project:zaman-ba689', '--paths', 'employees'])
  assert.equal(r2.status, 2)
})
