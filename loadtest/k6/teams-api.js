import { check, sleep } from 'k6'
import exec from 'k6/execution'
import { Counter, Rate, Trend } from 'k6/metrics'
import http from 'k6/http'
import { PROFILES } from '../config/profiles.js'
import {
  API_URL, BYPASS, GUARD, IDENTITIES, PEOPLE, PROFILE, RUN_ID,
  addDays, and, between, eq, pick, runQuery, signIn, teams,
} from './lib/env.js'
import { INTRUSION_SUFFIX, runTag } from '../lib/tag.js'

// Realistic mixed traffic: managers building, editing and publishing a week;
// employees reading their shifts and updating availability; a small share of
// hostile cross-workplace probes. Each VU is one seeded person, with think
// time between steps.
//
// Run through loadtest/scripts/run.mjs, which seeds, checks the target,
// verifies data integrity afterwards and writes the report.

const profile = PROFILES[PROFILE]
if (!profile) throw new Error(`Unknown profile ${PROFILE}`)

// Thresholds: defaults are sanity bounds only. After a clean baseline run,
// `run.mjs --save-baseline` writes config/thresholds.baseline.json from the
// measured p95/p99 and later runs are judged against that instead.
const thresholdFile = __ENV.THRESHOLDS || '../config/thresholds.default.json'
const thresholds = Object.fromEntries(Object.entries(JSON.parse(open(thresholdFile))).filter(([k]) => !k.startsWith('_')))

// k6 only reports a tagged sub-metric when a threshold names it, so every
// action gets an always-true one to make per-action latency appear in the
// summary.
const ACTIONS = ['signIn', 'saveShift', 'deleteShift', 'publishSchedule', 'saveAvailability', 'health',
  'firestore.myShifts', 'firestore.managerWeek', 'firestore.crossTenant']
for (const a of ACTIONS) {
  thresholds[`http_req_duration{action:${a}}`] ||= ['max>=0']
  thresholds[`http_reqs{action:${a}}`] ||= ['count>=0']
}

export const options = {
  scenarios: { mixed: { ...profile.scenario, exec: 'mixed' } },
  thresholds,
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // One sign-in per VU, not per iteration, as a real app keeps its session.
  noCookiesReset: true,
  setupTimeout: '2m',
}

const unexpected = new Rate('unexpected_responses')
const rateLimited = new Rate('rate_limited')
const conflicts = new Counter('business_conflicts')
const securityViolations = new Counter('security_violations')
const authFailures = new Counter('auth_failures')
const timeouts = new Counter('timeouts')
const shiftsCreated = new Counter('shifts_created')
const shiftsDeleted = new Counter('shifts_deleted')
const firestoreMs = new Trend('firestore_query_ms', true)
const workflowMs = new Trend('workflow_ms', true)

// Statuses each step can legitimately return. Anything else is unexpected.
const OK = new Set([200])
const BUSINESS = new Set([409, 422]) // overlap, stale version, ineligible

function record(res, { expected = OK, business = BUSINESS } = {}) {
  if (res.status === 0) timeouts.add(1)
  if (res.status === 401) authFailures.add(1)
  rateLimited.add(res.status === 429)
  if (business.has(res.status)) conflicts.add(1)
  unexpected.add(!(expected.has(res.status) || business.has(res.status) || res.status === 429))
  return res
}

// Per-VU state.
let me = null
let session = null
const mine = [] // shifts this VU created: { shiftId, version }

function ensureSession() {
  if (!me) me = PEOPLE[(exec.vu.idInTest - 1) % PEOPLE.length]
  if (!session || Date.now() > session.expiresAt) {
    session = signIn(me.email)
    if (!session) { authFailures.add(1); unexpected.add(true); return false }
  }
  return true
}

const buildWeek = addDays(IDENTITIES.nextWeek, 7)
const tenantOf = (p) => IDENTITIES.tenants[p.tenant]

function managerBuild() {
  const staff = tenantOf(me).staff
  for (let i = 0; i < Math.ceil(between(2, 5)); i++) {
    const start = Math.floor(between(6, 15))
    const len = Math.floor(between(4, 9))
    const res = record(teams('saveShift', session.idToken, {
      bizId: me.bizId,
      staffId: pick(staff).staffId,
      date: addDays(buildWeek, Math.floor(between(0, 7))),
      start: `${String(start).padStart(2, '0')}:00`,
      end: `${String((start + len) % 24).padStart(2, '0')}:00`,
      positionName: runTag(RUN_ID),
    }))
    if (res.status === 200) {
      shiftsCreated.add(1)
      mine.push({ shiftId: res.json('shiftId'), version: res.json('version') })
    }
    sleep(between(2, 6))
  }
}

function managerEdit() {
  const s = mine.length ? pick(mine) : null
  if (!s) return managerBuild()
  const staff = tenantOf(me).staff
  const res = record(teams('saveShift', session.idToken, {
    bizId: me.bizId, shiftId: s.shiftId, expectedVersion: s.version, staffId: pick(staff).staffId,
    date: addDays(buildWeek, Math.floor(between(0, 7))), start: '10:00', end: '14:00', positionName: runTag(RUN_ID),
  }), { business: new Set([404, 409, 422]) })
  if (res.status === 200) s.version = res.json('version')
}

function managerDelete() {
  if (!mine.length) return managerBuild()
  const [s] = mine.splice(Math.floor(Math.random() * mine.length), 1)
  const res = record(teams('deleteShift', session.idToken, { bizId: me.bizId, shiftId: s.shiftId }), { business: new Set([404, 409]) })
  if (res.status === 200) shiftsDeleted.add(1)
}

function managerPublish() {
  record(teams('publishSchedule', session.idToken, { bizId: me.bizId, weekStart: IDENTITIES.nextWeek }))
}

function managerReview() {
  const t0 = Date.now()
  const res = runQuery(session.idToken, `businesses/${me.bizId}`, { from: [{ collectionId: 'shifts' }], where: eq('date', addDays(IDENTITIES.nextWeek, 1)) }, { action: 'firestore.managerWeek' })
  firestoreMs.add(Date.now() - t0)
  record(res)
}

function employeeMyShifts() {
  const t0 = Date.now()
  const res = runQuery(session.idToken, `businesses/${me.bizId}`, {
    from: [{ collectionId: 'shifts' }],
    where: and(eq('assigneeUid', me.uid), eq('published', true)),
  }, { action: 'firestore.myShifts' })
  firestoreMs.add(Date.now() - t0)
  record(res)
  check(res, { 'my shifts are only mine': r => r.status !== 200 || (r.json() || []).every(row => !row.document || row.document.fields?.assigneeUid?.stringValue === me.uid) }) ||
    securityViolations.add(1)
}

function employeeAvailability() {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const weekly = Object.fromEntries(days.map(d => [d, Math.random() < 0.2
    ? { available: false }
    : { available: true, windows: [{ start: `${String(Math.floor(between(6, 12))).padStart(2, '0')}:00`, end: `${String(Math.floor(between(15, 23))).padStart(2, '0')}:00` }] }]))
  record(teams('saveAvailability', session.idToken, { bizId: me.bizId, weekly, preferredHoursPerWeek: Math.floor(between(10, 40)) }))
}

// Another workplace's data must stay out of reach, under load as at rest.
function crossTenantProbe() {
  const other = IDENTITIES.tenants[(me.tenant + 1) % IDENTITIES.tenants.length]
  if (other.bizId === me.bizId) return
  const read = runQuery(session.idToken, `businesses/${other.bizId}`, { from: [{ collectionId: 'shifts' }], limit: 5 }, { action: 'firestore.crossTenant' })
  const write = teams('saveShift', session.idToken, {
    bizId: other.bizId, staffId: other.staff[0].staffId, date: addDays(buildWeek, 2), start: '01:00', end: '02:00', positionName: runTag(RUN_ID, INTRUSION_SUFFIX),
  }, { probe: 'crossTenant' })
  const refused = (r) => [403, 404].includes(r.status)
  if (!check(read, { 'cross-tenant read refused': refused })) securityViolations.add(1)
  if (!check(write, { 'cross-tenant write refused': r => refused(r) || r.status === 429 })) securityViolations.add(1)
}

function health() {
  record(http.get(`${API_URL}/api/teams/health`, { headers: BYPASS, tags: { action: 'health' } }))
}

function weighted(table) {
  let r = Math.random() * table.reduce((n, [w]) => n + w, 0)
  for (const [w, fn] of table) { if ((r -= w) <= 0) return fn }
  return table[0][1]
}

const MANAGER = [[40, managerBuild], [20, managerEdit], [10, managerDelete], [10, managerPublish], [15, managerReview], [5, health]]
const EMPLOYEE = [[50, employeeMyShifts], [25, employeeAvailability], [10, crossTenantProbe], [15, health]]

export function setup() {
  console.log(`profile=${PROFILE} env=${GUARD.environment} hosts=${GUARD.hosts.join(',')} people=${PEOPLE.length} run=${RUN_ID}`)
  return { runId: RUN_ID }
}

export function mixed() {
  if (!ensureSession()) { sleep(5); return }
  const t0 = Date.now()
  weighted(me.role === 'manager' ? MANAGER : EMPLOYEE)()
  workflowMs.add(Date.now() - t0, { role: me.role })
  sleep(between(3, 12))
}

export function handleSummary(data) {
  const out = __ENV.SUMMARY_OUT || `../results/${RUN_ID}-summary.json`
  return { [out]: JSON.stringify(data, null, 2), stdout: `\nsummary written to ${out}\n` }
}
