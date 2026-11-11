#!/usr/bin/env node
// Restores Firebase Auth accounts from `firebase auth:export --format=json`
// into an ISOLATED target and checks that every account arrived.
//
//   node ops/backup/auth-restore.mjs --export backups/x/auth-users.json --into emulator
//   node ops/backup/auth-restore.mjs --export ... --into project:<isolated-id> --credentials <sa.json> --hash-config hash.json
//
// Firestore backups do not include Auth. Accounts keep their uid, email,
// verification state, providers and custom claims. Passwords only work if the
// SOURCE project's scrypt parameters are given (--hash-config: {"key","saltSeparator",
// "rounds","memoryCost"} from Console → Authentication → Users → ⋮ → Password hash
// parameters); without them, people sign in with Google or reset their password.
// The production project is refused.

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { PRODUCTION_PROJECTS, parseTarget } from './lib/firestore-rest.mjs'

const { values: a } = parseArgs({ options: { export: { type: 'string' }, into: { type: 'string' }, credentials: { type: 'string' }, 'hash-config': { type: 'string' } } })
if (!a.export || !a.into) { console.error('usage: auth-restore.mjs --export <file> --into <target>'); process.exit(2) }
const target = parseTarget(a.into)
if (PRODUCTION_PROJECTS.includes(target.projectId)) { console.error(`refused: ${target.projectId} is production`); process.exit(2) }

const { initializeApp, cert } = await import('firebase-admin/app')
const { getAuth } = await import('firebase-admin/auth')
if (target.kind === 'emulator') {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
  initializeApp({ projectId: target.projectId })
} else {
  if (!a.credentials) { console.error('a real project needs --credentials'); process.exit(2) }
  const sa = JSON.parse(readFileSync(a.credentials, 'utf8'))
  if (sa.project_id !== target.projectId) { console.error(`credentials are for ${sa.project_id}`); process.exit(2) }
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST
  initializeApp({ credential: cert(sa) })
}
const auth = getAuth()

const users = JSON.parse(readFileSync(a.export, 'utf8')).users || []
const hc = a['hash-config'] ? JSON.parse(readFileSync(a['hash-config'], 'utf8')) : null
const hash = hc ? { algorithm: 'SCRYPT', key: Buffer.from(hc.key, 'base64'), saltSeparator: Buffer.from(hc.saltSeparator, 'base64'), rounds: hc.rounds, memoryCost: hc.memoryCost } : null

const records = users.map(u => ({
  uid: u.localId,
  email: u.email,
  emailVerified: Boolean(u.emailVerified),
  displayName: u.displayName,
  disabled: Boolean(u.disabled),
  metadata: { creationTime: u.createdAt ? new Date(Number(u.createdAt)).toUTCString() : undefined, lastSignInTime: u.lastSignedInAt ? new Date(Number(u.lastSignedInAt)).toUTCString() : undefined },
  customClaims: u.customAttributes ? JSON.parse(u.customAttributes) : undefined,
  providerData: (u.providerUserInfo || []).filter(p => p.providerId !== 'password').map(p => ({ uid: p.rawId, providerId: p.providerId, email: p.email, displayName: p.displayName })),
  ...(hash && u.passwordHash ? { passwordHash: Buffer.from(u.passwordHash, 'base64'), passwordSalt: Buffer.from(u.salt || '', 'base64') } : {}),
}))

let imported = 0
const errors = []
for (let i = 0; i < records.length; i += 1000) {
  const batch = records.slice(i, i + 1000)
  const r = await auth.importUsers(batch, hash ? { hash } : undefined)
  imported += r.successCount
  errors.push(...r.errors.map(e => `${batch[e.index].uid}: ${e.error.message}`))
}

// Verify: every uid exists with the same email and verification state.
let verified = 0
for (let i = 0; i < users.length; i += 100) {
  const chunk = users.slice(i, i + 100)
  const r = await auth.getUsers(chunk.map(u => ({ uid: u.localId })))
  const byUid = new Map(r.users.map(u => [u.uid, u]))
  for (const u of chunk) {
    const got = byUid.get(u.localId)
    if (got && got.email === u.email && got.emailVerified === Boolean(u.emailVerified)) verified++
  }
}
console.log(`auth: imported ${imported}/${users.length}, verified ${verified}/${users.length} into ${target.label}${hash ? ' (with password hashes)' : ' (no hash parameters: passwords not restored)'}`)
for (const e of errors.slice(0, 5)) console.log(`  error ${e}`)
process.exit(verified === users.length ? 0 : 1)
