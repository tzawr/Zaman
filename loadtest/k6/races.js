import { check } from 'k6'
import exec from 'k6/execution'
import { Counter } from 'k6/metrics'
import { IDENTITIES, PROFILE, RUN_ID, addDays, eq, and, runQuery, signIn, teams } from './lib/env.js'
import { runTag } from '../lib/tag.js'

// Write races, fired simultaneously at one workplace:
//  - overlap: N managers' requests book the same person into overlapping
//    hours at once. At most one may win, or the person is double-booked.
//  - stale:   N requests edit the same shift from the same version at once.
//    Exactly one may win; the rest must get 409 stale.
//  - parallel: N saves for different people (no overlaps) in one week at once,
//    which is what a manager building a week looks like. Every one must land.
//  - publish: saves into a week while it is being published. Afterwards every
//    live shift in a published week must itself be published, or someone has
//    a shift they cannot see.
// The checks read Firestore afterwards, so they test what was stored, not
// what the responses claimed.

const N = Number(__ENV.RACERS || 25)
if (PROFILE !== 'race') throw new Error('races.js runs with PROFILE=race')

export const options = {
  scenarios: {
    overlap: { executor: 'per-vu-iterations', vus: N, iterations: 1, exec: 'overlap', maxDuration: '2m' },
    stale: { executor: 'per-vu-iterations', vus: N, iterations: 1, exec: 'stale', startTime: '40s', maxDuration: '2m' },
    parallel: { executor: 'per-vu-iterations', vus: N, iterations: 1, exec: 'parallel', startTime: '80s', maxDuration: '2m' },
    publish: { executor: 'per-vu-iterations', vus: N, iterations: 1, exec: 'publishRace', startTime: '120s', maxDuration: '2m' },
  },
  thresholds: {
    double_bookings: ['count==0'], lost_updates: ['count==0'], lost_parallel_saves: ['count==0'], hidden_shifts: ['count==0'],
    'http_req_duration{race:parallel}': ['max>=0'], 'http_req_duration{race:overlap}': ['max>=0'],
    'http_req_duration{race:stale}': ['max>=0'], 'http_req_duration{race:publish}': ['max>=0'],
  },
  setupTimeout: '2m',
}

const doubleBookings = new Counter('double_bookings')
const lostUpdates = new Counter('lost_updates')
const lostParallel = new Counter('lost_parallel_saves')
const hiddenShifts = new Counter('hidden_shifts')
const parallelOk = new Counter('parallel_saved')

const tenant = IDENTITIES.tenants[0]
// Staging keeps data between runs, so each run races in its own weeks, far
// enough ahead that nothing else is scheduled there.
const RUN_WEEKS = 7 * (20 + (Number(String(RUN_ID).replace(/[^0-9]/g, '').slice(-6)) % 400))
const date = addDays(IDENTITIES.nextWeek, RUN_WEEKS + 14 + 3)

export function setup() {
  const owner = signIn(tenant.owner.email)
  // One shift to fight over in the stale race.
  const seed = teams('saveShift', owner.idToken, { bizId: tenant.bizId, staffId: tenant.staff[1].staffId, date: addDays(date, 1), start: '08:00', end: '12:00', positionName: runTag(RUN_ID, 'stale') })
  check(seed, { 'stale-race shift created': r => r.status === 200 })
  return { token: owner.idToken, shiftId: seed.json('shiftId'), version: seed.json('version') }
}

// Wait for every racer to be signed in and ready, then go together.
function barrier(startAt) {
  while (Date.now() < startAt) { /* spin: sleep() granularity is too coarse */ }
}

export function overlap(data) {
  barrier(exec.scenario.startTime + 3000)
  const i = exec.vu.idInTest
  // Every request overlaps every other: all start between 09:00 and 09:24.
  const res = teams('saveShift', data.token, {
    bizId: tenant.bizId, staffId: tenant.staff[0].staffId, date,
    start: `09:${String(i % 25).padStart(2, '0')}`, end: '17:00', positionName: runTag(RUN_ID, 'over'),
  }, { race: 'overlap' })
  check(res, { 'overlap: 200 or 409': r => [200, 409, 503].includes(r.status) })
}

export function stale(data) {
  barrier(exec.scenario.startTime + 3000)
  const res = teams('saveShift', data.token, {
    bizId: tenant.bizId, shiftId: data.shiftId, expectedVersion: data.version, staffId: tenant.staff[1].staffId,
    date: addDays(date, 1), start: '08:00', end: `${12 + (exec.vu.idInTest % 6)}:00`, positionName: runTag(RUN_ID, 'stale'),
  }, { race: 'stale' })
  check(res, { 'stale: 200 or 409': r => [200, 409, 503].includes(r.status) })
}

// Different people, different days: nothing overlaps, so every save must land.
const parallelWeek = addDays(IDENTITIES.nextWeek, RUN_WEEKS + 21)
// k6 reuses VU ids across scenarios, so each scenario numbers its own racers.
export function parallel(data) {
  barrier(exec.scenario.startTime + 3000)
  const i = exec.scenario.iterationInTest
  const res = teams('saveShift', data.token, {
    bizId: tenant.bizId, staffId: tenant.staff[i % tenant.staff.length].staffId,
    date: addDays(parallelWeek, Math.floor(i / tenant.staff.length) % 7),
    start: '09:00', end: '13:00', positionName: runTag(RUN_ID, 'par'),
  }, { race: 'parallel' })
  if (res.status === 200) parallelOk.add(1)
  check(res, { 'parallel: saved': r => r.status === 200 })
}

// One VU publishes the week while the others keep saving into it.
const publishWeek = addDays(IDENTITIES.nextWeek, RUN_WEEKS + 28)
export function publishRace(data) {
  const i = exec.scenario.iterationInTest
  if (i === 0) {
    // A shift so the week exists and can be published.
    teams('saveShift', data.token, { bizId: tenant.bizId, staffId: tenant.staff[0].staffId, date: publishWeek, start: '06:00', end: '08:00', positionName: runTag(RUN_ID, 'pub') }, { race: 'publish' })
  }
  barrier(exec.scenario.startTime + 3000)
  if (i === 0) {
    check(teams('publishSchedule', data.token, { bizId: tenant.bizId, weekStart: publishWeek }, { race: 'publish' }), { 'publish: ok': r => r.status === 200 })
    return
  }
  teams('saveShift', data.token, {
    bizId: tenant.bizId, staffId: tenant.staff[i % tenant.staff.length].staffId,
    date: addDays(publishWeek, 1 + (Math.floor(i / tenant.staff.length) % 6)),
    start: '10:00', end: '14:00', positionName: runTag(RUN_ID, 'pub'),
  }, { race: 'publish' })
}

export function teardown(data) {
  const rows = (runQuery(data.token, `businesses/${tenant.bizId}`, {
    from: [{ collectionId: 'shifts' }],
    where: and(eq('staffId', tenant.staff[0].staffId), eq('date', date)),
  }).json() || []).filter(r => r.document && r.document.fields?.status?.stringValue !== 'cancelled')
  console.log(`overlap race: ${rows.length} shift(s) stored for one person in overlapping hours`)
  if (rows.length > 1) doubleBookings.add(rows.length - 1)

  const doc = (runQuery(data.token, `businesses/${tenant.bizId}`, {
    from: [{ collectionId: 'shifts' }], where: eq('positionName', runTag(RUN_ID, 'stale')),
  }).json() || []).find(r => r.document)
  const version = Number(doc?.document?.fields?.version?.integerValue)
  console.log(`stale race: shift went from version ${data.version} to ${version}`)
  // Exactly one edit may land on top of the starting version.
  if (version !== data.version + 1) lostUpdates.add(1)

  const parallelStored = (runQuery(data.token, `businesses/${tenant.bizId}`, {
    from: [{ collectionId: 'shifts' }], where: eq('positionName', runTag(RUN_ID, 'par')),
  }).json() || []).filter(r => r.document).length
  console.log(`parallel race: ${parallelStored} of ${N} non-overlapping saves stored`)
  if (parallelStored !== N) lostParallel.add(N - parallelStored)

  const week = runQuery(data.token, `businesses/${tenant.bizId}`, {
    from: [{ collectionId: 'schedules' }], where: eq('weekStart', publishWeek),
  }).json().find(r => r.document)
  const weekPublished = week?.document?.fields?.status?.stringValue === 'published'
  const inWeek = (runQuery(data.token, `businesses/${tenant.bizId}`, {
    from: [{ collectionId: 'shifts' }], where: eq('positionName', runTag(RUN_ID, 'pub')),
  }).json() || []).filter(r => r.document && r.document.fields?.status?.stringValue !== 'cancelled')
  const hidden = weekPublished ? inWeek.filter(r => r.document.fields?.published?.booleanValue !== true).length : 0
  console.log(`publish race: week ${weekPublished ? 'published' : 'NOT published'}, ${inWeek.length} shifts, ${hidden} left unpublished`)
  if (!weekPublished) hiddenShifts.add(1000)
  hiddenShifts.add(hidden)
}

export function handleSummary(d) {
  const out = __ENV.SUMMARY_OUT || `../results/${RUN_ID}-races.json`
  return { [out]: JSON.stringify(d, null, 2), stdout: `\nsummary written to ${out}\n` }
}
