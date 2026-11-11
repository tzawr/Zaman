// Synthetic tenants for load and journey tests: workplaces, managers,
// employees (some joined, some only invited), weekly availability and a
// starting schedule. Writes the identities k6 signs in as to
// loadtest/.data/identities.json (git-ignored).
//
//   node loadtest/data/seed.mjs --tenants 20 --staff 8            (emulators)
//   node loadtest/data/seed.mjs --staging --tenants 5             (staging)
//
// Emulator mode refuses any non-loopback emulator host and any project that
// is not demo-*. Staging mode takes the service account named in
// loadtest/.data/staging.json and refuses it unless its project is the
// allowlisted staging project (and never the production one); it only adds
// accounts and workplaces, tagged per run, and never deletes anything.

import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    tenants: { type: 'string', default: '20' },
    staff: { type: 'string', default: '8' },
    out: { type: 'string', default: resolve(import.meta.dirname, '../.data/identities.json') },
    keep: { type: 'boolean', default: false },
    // Seed the staging project in loadtest/.data/staging.json instead of the
    // emulators. Never wipes anything there: each run adds its own tagged set.
    staging: { type: 'boolean', default: false },
  },
})

let stagingProject = null
if (args.staging) {
  const { readFileSync } = await import('node:fs')
  const { PRODUCTION_FIREBASE_PROJECTS } = await import('../lib/guard.js')
  const cfg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../.data/staging.json'), 'utf8'))
  const { targetsPath } = await import('../lib/targets.mjs')
  const targets = JSON.parse(readFileSync(targetsPath(resolve(import.meta.dirname, '..')), 'utf8'))
  const saJson = readFileSync(cfg.serviceAccountPath, 'utf8')
  const sa = JSON.parse(saJson)
  if (PRODUCTION_FIREBASE_PROJECTS.includes(sa.project_id)) throw new Error('seed: that is the production service account. Refused.')
  if (sa.project_id !== cfg.projectId || !targets.staging.firebaseProjects.includes(sa.project_id)) {
    throw new Error(`seed: service account project ${sa.project_id} is not the allowlisted staging project`)
  }
  for (const k of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GCLOUD_PROJECT']) delete process.env[k]
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = saJson
  stagingProject = sa.project_id
} else {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
  process.env.GCLOUD_PROJECT ||= 'demo-hengam'
  for (const h of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST]) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(h)) throw new Error(`seed: refusing non-loopback emulator host ${h}`)
  }
  if (!process.env.GCLOUD_PROJECT.startsWith('demo-')) throw new Error('seed: emulator project must be demo-*')
}

const { initAdmin } = await import('../../api/_firebase-admin.js')
const { getAuth } = await import('firebase-admin/auth')
const { getFirestore } = await import('firebase-admin/firestore')
const ws = await import('../../api/_teams-workspaces.js')
const sched = await import('../../api/_teams-schedules.js')
const av = await import('../../api/_teams-availability.js')
const { addDays, todayIn, weekStartOf } = await import('../../shared/teams/time.js')

initAdmin()
const db = getFirestore()
const auth = getAuth()
const now = new Date()
const TZ = 'America/Los_Angeles'
const PASSWORD = `lt-${randomBytes(9).toString('base64url')}`
const TENANTS = Number(args.tenants)
const STAFF = Number(args.staff)

const FIRST = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lia', 'Mo', 'Nia', 'Oz', 'Pia']
const LAST = ['Lima', 'Ortiz', 'Park', 'Rao', 'Silva', 'Tan', 'Ueda', 'Vega', 'Wolfe', 'Xu', 'Young', 'Zhou']
const BIZ = ['Cafe', 'Bakery', 'Bar', 'Clinic', 'Market', 'Studio', 'Diner', 'Shop']

// Each run's accounts carry a tag, so staging runs never collide.
const RUN = args.staging ? `r${Date.now().toString(36)}` : ''
if (!args.keep && !args.staging) {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/accounts`, { method: 'DELETE' })
}

async function account(email, name) {
  const user = await auth.createUser({ email, password: PASSWORD, displayName: name, emailVerified: true })
  return { uid: user.uid, email, token: { uid: user.uid, email, email_verified: true, name } }
}
const run = (fn, who, input) => fn({ db, uid: who.uid, token: who.token, input, now })

const weekly = (seed) => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d, i) => [
  d, (i + seed) % 7 === 6 ? { available: false } : { available: true, windows: [{ start: (i + seed) % 2 ? '07:00' : '12:00', end: (i + seed) % 2 ? '15:00' : '22:00' }] },
]))

const thisWeek = weekStartOf(todayIn(TZ))
const nextWeek = addDays(thisWeek, 7)

async function tenant(t) {
  const tag = `${RUN}t${String(t).padStart(3, '0')}`
  const owner = await account(`lt-${tag}-owner@example.test`, `Owner ${tag}`)
  const { bizId } = await run(ws.createBusiness, owner, { name: `${FIRST[t % FIRST.length]}'s ${BIZ[t % BIZ.length]} ${tag}`, timezone: TZ, requestId: `lt-seed-${tag}-0001` })
  const staff = []
  for (let s = 0; s < STAFF; s++) {
    const name = `${FIRST[(t + s) % FIRST.length]} ${LAST[(t * 3 + s) % LAST.length]} ${tag}${s}`
    const invite = await run(ws.createInvite, owner, { bizId, name })
    // A quarter of the team has not joined yet, as in a real roll-out.
    if (s % 4 === 3) { staff.push({ staffId: invite.staffId, name, joined: false }); continue }
    const member = await account(`lt-${tag}-s${s}@example.test`, name)
    await run(ws.acceptInvite, member, { code: invite.code })
    await run(av.saveAvailability, member, { bizId, weekly: weekly(s), preferredHoursPerWeek: 20 + (s % 3) * 8 })
    staff.push({ staffId: invite.staffId, name, joined: true, uid: member.uid, email: member.email })
  }
  // A published current week and a draft next week, so reads have data.
  for (const [i, p] of staff.entries()) {
    await run(sched.saveShift, owner, { bizId, staffId: p.staffId, date: addDays(thisWeek, i % 5), start: '09:00', end: '17:00', positionName: 'Floor' })
    await run(sched.saveShift, owner, { bizId, staffId: p.staffId, date: addDays(nextWeek, i % 5), start: '12:00', end: '20:00', positionName: 'Floor' })
  }
  await run(sched.publishSchedule, owner, { bizId, weekStart: thisWeek })
  return { tag, bizId, owner: { uid: owner.uid, email: owner.email }, staff }
}

const started = Date.now()
const tenants = []
for (let i = 0; i < TENANTS; i += 5) {
  tenants.push(...await Promise.all(Array.from({ length: Math.min(5, TENANTS - i) }, (_, k) => tenant(i + k))))
}
mkdirSync(resolve(args.out, '..'), { recursive: true })
writeFileSync(args.out, JSON.stringify({
  projectId: stagingProject || process.env.GCLOUD_PROJECT,
  createdAt: now.toISOString(),
  timezone: TZ,
  thisWeek,
  nextWeek,
  password: PASSWORD,
  tenants,
}, null, 2))
const people = tenants.reduce((n, t) => n + 1 + t.staff.filter(s => s.joined).length, 0)
console.log(`seeded ${tenants.length} workplaces, ${people} accounts in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${args.out}`)
process.exit(0)
