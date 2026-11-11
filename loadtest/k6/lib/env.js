import http from 'k6/http'
import { checkRun } from '../../lib/guard.js'

// Shared by every k6 script: where traffic goes, the safety check, and signing
// in. All of it runs in the init context, so a refused target aborts the run
// in every VU before a single request is sent.

export const PROFILE = __ENV.PROFILE || 'smoke'
export const API_URL = (__ENV.API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')
export const AUTH_URL = (__ENV.AUTH_URL || 'http://127.0.0.1:9099/identitytoolkit.googleapis.com').replace(/\/$/, '')
export const FIRESTORE_URL = (__ENV.FIRESTORE_URL || 'http://127.0.0.1:8085').replace(/\/$/, '')
export const API_KEY = __ENV.FIREBASE_API_KEY || 'demo-key'
export const RUN_ID = __ENV.RUN_ID || `run${Date.now()}`

// The real staging allowlist is git-ignored (.data); the committed file is an
// empty template.
let targets
try { targets = JSON.parse(open('../../.data/targets.json')) } catch { targets = JSON.parse(open('../../config/targets.json')) }
export const IDENTITIES = JSON.parse(open(__ENV.IDENTITIES || '../../.data/identities.json'))
export const PROJECT_ID = __ENV.PROJECT_ID || IDENTITIES.projectId

export const GUARD = checkRun({
  urls: [API_URL, AUTH_URL, FIRESTORE_URL],
  profile: PROFILE,
  projectId: PROJECT_ID,
  targets,
  approval: __ENV.LOADTEST_APPROVAL || '',
})

// Every account the seed made, flattened: owners manage, joined staff work.
export const PEOPLE = IDENTITIES.tenants.flatMap((t, ti) => [
  { role: 'manager', tenant: ti, bizId: t.bizId, email: t.owner.email, uid: t.owner.uid },
  ...t.staff.filter(s => s.joined).map(s => ({ role: 'employee', tenant: ti, bizId: t.bizId, email: s.email, uid: s.uid, staffId: s.staffId })),
])

export { BYPASS }

/** Signs in with email and password; returns { idToken, uid, expiresAt }. */
export function signIn(email) {
  const res = http.post(
    `${AUTH_URL}/v1/accounts:signInWithPassword?key=${API_KEY}`,
    JSON.stringify({ email, password: IDENTITIES.password, returnSecureToken: true }),
    { headers: { 'Content-Type': 'application/json' }, tags: { action: 'signIn' } },
  )
  if (res.status !== 200) return null
  const body = res.json()
  return { idToken: body.idToken, uid: body.localId, expiresAt: Date.now() + (Number(body.expiresIn) - 300) * 1000 }
}

// Staging keeps Vercel Deployment Protection on; automated traffic carries
// the project's bypass secret.
const BYPASS = __ENV.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': __ENV.VERCEL_BYPASS } : {}

export function teams(action, token, body, tags = {}) {
  return http.post(`${API_URL}/api/teams/${action}`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...BYPASS },
    tags: { action, ...tags },
    timeout: '30s',
  })
}

/** A Firestore query as the signed-in user, so security rules apply. */
export function runQuery(token, parent, structuredQuery, tags = {}) {
  return http.post(
    `${FIRESTORE_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${parent}:runQuery`,
    JSON.stringify({ structuredQuery }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, tags: { action: 'firestore.runQuery', ...tags }, timeout: '30s' },
  )
}

export const eq = (field, value) => ({
  fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: typeof value === 'boolean' ? { booleanValue: value } : { stringValue: String(value) } },
})
export const and = (...filters) => ({ compositeFilter: { op: 'AND', filters } })

export function addDays(dateString, n) {
  const d = new Date(`${dateString}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const pick = (list) => list[Math.floor(Math.random() * list.length)]
export const between = (lo, hi) => lo + Math.random() * (hi - lo)
