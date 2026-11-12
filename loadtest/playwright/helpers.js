// Helpers for the Playwright journeys, against either target:
//   emulators (default)  loopback, demo-hengam
//   staging              E2E_TARGET=staging, settings in loadtest/.data/staging.json
// Both go through loadtest/lib/guard.js, so production is refused in either
// mode. In staging mode, "admin" reads and writes (rules bypassed, used only to
// check what was stored or to set up a test) use the staging service
// account's OAuth token against the same REST endpoints.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkRun } from '../lib/guard.js'
import { targetsPath } from '../lib/targets.mjs'

const root = resolve(import.meta.dirname, '..')
export const STAGING = process.env.E2E_TARGET === 'staging'
const staging = STAGING ? JSON.parse(readFileSync(resolve(root, '.data/staging.json'), 'utf8')) : null
const targets = JSON.parse(readFileSync(targetsPath(root), 'utf8'))

export const PROJECT_ID = STAGING ? staging.projectId : 'demo-hengam'
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'
const AUTH_BASE = STAGING ? 'https://identitytoolkit.googleapis.com' : `http://${AUTH_HOST}/identitytoolkit.googleapis.com`
const API_KEY = STAGING ? staging.apiKey : 'demo-key'
const DOCS = `${STAGING ? 'https://firestore.googleapis.com' : `http://${FS_HOST}`}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
export const API = STAGING ? staging.appUrl : (process.env.E2E_API_URL || 'http://127.0.0.1:3001')
export const APP = STAGING ? staging.appUrl : 'http://127.0.0.1:5175'
// Vercel Deployment Protection stays on for staging; automated calls carry
// the project's bypass secret.
export const BYPASS = STAGING ? { 'x-vercel-protection-bypass': staging.bypassSecret } : {}
/** On staging, one visit with the bypass sets a cookie for this browser context. */
export async function allowStaging(page) {
  if (STAGING) await page.goto(`/?x-vercel-protection-bypass=${BYPASS['x-vercel-protection-bypass']}&x-vercel-set-bypass-cookie=true`)
}

checkRun({ urls: STAGING ? [API] : [API, `http://${AUTH_HOST}`, `http://${FS_HOST}`], profile: 'smoke', projectId: PROJECT_ID, targets })

let adminToken = null
async function adminAuth() {
  if (!STAGING) return { Authorization: 'Bearer owner' } // the emulators' rules bypass
  if (!adminToken || adminToken.expires < Date.now() + 60_000) {
    const { cert } = await import('firebase-admin/app')
    const sa = JSON.parse(readFileSync(staging.serviceAccountPath, 'utf8'))
    if (sa.project_id !== PROJECT_ID) throw new Error(`service account is for ${sa.project_id}, not ${PROJECT_ID}`)
    const t = await cert(sa).getAccessToken()
    adminToken = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 }
  }
  return { Authorization: `Bearer ${adminToken.value}` }
}

export const uniqueEmail = (tag) => `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function signIn(email, password) {
  const r = await fetch(`${AUTH_BASE}/v1/accounts:signInWithPassword?key=${API_KEY}`, json({ email, password, returnSecureToken: true }))
  const b = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(b))
  return { uid: b.localId, idToken: b.idToken, email, password }
}

export async function signUp(email = uniqueEmail('u'), password = 'e2e-pass-123') {
  const r = await fetch(`${AUTH_BASE}/v1/accounts:signUp?key=${API_KEY}`, json({ email, password, returnSecureToken: true }))
  const b = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(b))
  return { uid: b.localId, idToken: b.idToken, email, password }
}

/** Marks the account verified (admin), then signs in again for a token carrying email_verified. */
export async function verifyEmail(user) {
  const url = STAGING
    ? `${AUTH_BASE}/v1/projects/${PROJECT_ID}/accounts:update`
    : `${AUTH_BASE}/v1/accounts:update?key=demo-key`
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await adminAuth()) }, body: JSON.stringify({ localId: user.uid, emailVerified: true }) })
  if (!r.ok) throw new Error(`verifyEmail: ${r.status} ${await r.text()}`)
  user.idToken = (await signIn(user.email, user.password)).idToken
  return user
}

// Firestore REST, as the signed-in user, so security rules apply.
const enc = (v) => {
  if (v === null) return { nullValue: null }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
  return { stringValue: String(v) }
}
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]))
const auth = (token) => (token ? { Authorization: `Bearer ${token}` } : {})
const mask = (data) => Object.keys(data).map(k => `updateMask.fieldPaths=${k}`).join('&')

export const fs = {
  get: (token, path) => fetch(`${DOCS}/${path}`, { headers: auth(token) }),
  create: (token, collection, data) => fetch(`${DOCS}/${collection}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ fields: fields(data) }) }),
  patch: (token, path, data) => fetch(`${DOCS}/${path}?${mask(data)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ fields: fields(data) }) }),
  remove: (token, path) => fetch(`${DOCS}/${path}`, { method: 'DELETE', headers: auth(token) }),
  query: (token, parent, structuredQuery) => fetch(`${DOCS}${parent ? `/${parent}` : ''}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify({ structuredQuery }) }),
  // Admin view (rules bypassed) for checking what was really stored.
  adminGet: async (path) => fetch(`${DOCS}/${path}`, { headers: await adminAuth() }),
  adminQuery: async (structuredQuery) => fetch(`${DOCS}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await adminAuth()) }, body: JSON.stringify({ structuredQuery }) }),
  // Merges: only the given fields are written (a PATCH without a mask replaces the doc).
  adminSet: async (path, data) => fetch(`${DOCS}/${path}?${mask(data)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await adminAuth()) }, body: JSON.stringify({ fields: fields(data) }) }),
}

/**
 * A batch of writes as the signed-in user (rules apply to the batch as a
 * whole, which is how getAfter() checks work). Each write:
 * { path, data, serverTime: ['field', ...] }; only the listed fields change.
 */
export function commit(token, writes) {
  const name = (path) => `projects/${PROJECT_ID}/databases/(default)/documents/${path}`
  return fetch(`${DOCS}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({
      writes: writes.map(w => ({
        update: { name: name(w.path), fields: fields(w.data) },
        updateMask: { fieldPaths: Object.keys(w.data) },
        ...(w.serverTime ? { updateTransforms: w.serverTime.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
      })),
    }),
  })
}

export const whereEq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } })

/** Any API route, with the staging bypass header when needed. */
export async function api(path, { method = 'POST', token, body, headers = {} } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...auth(token), ...BYPASS, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let parsed = null
  try { parsed = await r.json() } catch { /* empty */ }
  return { status: r.status, body: parsed, headers: r.headers }
}

export const teams = (action, token, body) => api(`/api/teams/${action}`, { token, body })
