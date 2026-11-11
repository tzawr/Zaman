// Is a slow burst of saves caused by shared documents, or by the emulator?
// Times N simultaneous saveShift calls in three layouts:
//   same-week   N different people, one business, one week (the real case)
//   split-weeks N different people, one business, N different weeks
//   split-biz   N businesses, nothing shared at all
// If split-biz is as slow as same-week, the emulator is serializing
// transactions on its own and its latencies say nothing about production.
//
//   firebase emulators:exec --only firestore --project demo-hengam 'node loadtest/scripts/contention-probe.mjs'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('emulator only')
const { initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
const ws = await import('../../api/_teams-workspaces.js')
const sched = await import('../../api/_teams-schedules.js')
initializeApp({ projectId: 'demo-hengam' })
const db = getFirestore()
const now = new Date('2026-11-10T12:00:00Z')
const N = Number(process.env.N || 25)
const token = (uid) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid })
const call = (fn, uid, input) => fn({ db, uid, token: token(uid), input, now })

async function business(tag, people) {
  const { bizId } = await call(ws.createBusiness, `o-${tag}`, { name: `Biz ${tag}`, timezone: 'America/Los_Angeles', requestId: `probe-${tag}-0001` })
  const staff = []
  for (let i = 0; i < people; i++) staff.push((await call(ws.createInvite, `o-${tag}`, { bizId, name: `P${i} ${tag}` })).staffId)
  return { bizId, owner: `o-${tag}`, staff }
}

const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

async function burst(label, jobs) {
  const t0 = Date.now()
  const times = await Promise.all(jobs.map(async (j) => {
    const s = Date.now()
    try { await j(); return { ms: Date.now() - s, ok: true } } catch (e) { return { ms: Date.now() - s, ok: false, why: e.reason || e.code || e.message } }
  }))
  const ms = times.map(t => t.ms).sort((a, b) => a - b)
  const fails = times.filter(t => !t.ok)
  console.log(`${label.padEnd(12)} wall ${String(Date.now() - t0).padStart(6)} ms  p50 ${ms[Math.floor(N / 2)]} ms  max ${ms.at(-1)} ms  failed ${fails.length}${fails.length ? ` (${[...new Set(fails.map(f => f.why))].join(', ')})` : ''}`)
}

const one = await business('one', N)
await burst('same-week', one.staff.map((staffId, i) => () =>
  call(sched.saveShift, one.owner, { bizId: one.bizId, staffId, date: addDays('2026-12-07', i % 7), start: '09:00', end: '13:00' })))
await burst('split-weeks', one.staff.map((staffId, i) => () =>
  call(sched.saveShift, one.owner, { bizId: one.bizId, staffId, date: addDays('2027-01-04', i * 7), start: '09:00', end: '13:00' })))
const many = []
for (let i = 0; i < N; i++) many.push(await business(`m${i}`, 1))
await burst('split-biz', many.map(b => () =>
  call(sched.saveShift, b.owner, { bizId: b.bizId, staffId: b.staff[0], date: '2026-12-08', start: '09:00', end: '13:00' })))
process.exit(0)
