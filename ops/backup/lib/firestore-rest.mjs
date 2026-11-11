// Firestore over its REST API, for backup tooling that must keep every value
// exactly as stored. The Admin SDK turns integers and doubles into the same JS
// number and resolves references; the REST API's typed JSON
// ({integerValue}, {doubleValue}, {timestampValue}, {referenceValue}, ...)
// round-trips without loss.
//
// A target is one of:
//   emulator[:projectId[/database]]  local emulator (FIRESTORE_EMULATOR_HOST), demo-* only
//   project:<projectId>[/<database>] a real project, with an OAuth token
// Tokens: the emulator accepts "owner" (rules bypassed). Real projects take a
// service-account key (--credentials) or the Firebase CLI's own login.

import { readFileSync } from 'node:fs'

export const PRODUCTION_PROJECTS = ['zaman-ba689']

export function parseTarget(spec) {
  const s = String(spec || '')
  if (s === 'emulator' || s.startsWith('emulator:')) {
    const [projectId = 'demo-hengam', database = '(default)'] = (s.split(':')[1] || '').split('/').map(x => x || undefined)
    const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'
    if (!projectId.startsWith('demo-')) throw new Error('emulator targets use a demo-* project id')
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error(`refusing non-loopback emulator host ${host}`)
    return { kind: 'emulator', projectId, database, base: `http://${host}/v1`, label: `emulator ${projectId}/${database}` }
  }
  const m = s.match(/^project:([a-z0-9-]+)(?:\/([a-z0-9()-]+))?$/)
  if (!m) throw new Error(`unrecognised target "${s}" (use emulator[:id] or project:<id>[/<database>])`)
  const database = m[2] || '(default)'
  return { kind: 'project', projectId: m[1], database, base: 'https://firestore.googleapis.com/v1', label: `${m[1]}/${database}` }
}

export const isProduction = (t) => t.kind === 'project' && PRODUCTION_PROJECTS.includes(t.projectId)

/** Returns a function giving a current bearer token for the target. */
export async function tokenFor(target, { credentials } = {}) {
  if (target.kind === 'emulator') return async () => 'owner'
  if (credentials) {
    const sa = JSON.parse(readFileSync(credentials, 'utf8'))
    if (sa.project_id !== target.projectId) throw new Error(`credentials are for ${sa.project_id}, not ${target.projectId}`)
    const { cert } = await import('firebase-admin/app')
    const c = cert(sa)
    let cached = null
    return async () => {
      if (!cached || cached.expires < Date.now() + 60_000) {
        const t = await c.getAccessToken()
        cached = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 }
      }
      return cached.value
    }
  }
  // The signed-in Firebase CLI user (read-only drills against production).
  const FT = process.env.FIREBASE_TOOLS_DIR || '/Users/aseifiazad/.npm-global/lib/node_modules/firebase-tools'
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { requireAuth } = require(`${FT}/lib/requireAuth`)
  const { getGlobalDefaultAccount } = require(`${FT}/lib/auth`)
  const { getAccessToken } = require(`${FT}/lib/apiv2`)
  const a = getGlobalDefaultAccount()
  await requireAuth({ user: a.user, tokens: a.tokens })
  return async () => getAccessToken()
}

// readTime (RFC 3339, whole minute for PITR/clone) reads the database as it
// was at that moment, so a clone can be compared with its source exactly.
export function client(target, token, { readTime } = {}) {
  const root = `projects/${target.projectId}/databases/${target.database}/documents`
  async function call(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${target.base}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (r.ok) return r.json()
      if ([429, 500, 503].includes(r.status) && attempt < 5) { await new Promise(res => setTimeout(res, 500 * 2 ** attempt)); continue }
      throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`)
    }
  }
  return {
    root,
    async listCollectionIds(parent) {
      const ids = []
      let pageToken
      do {
        const r = await call('POST', `${parent}:listCollectionIds`, { pageSize: 300, pageToken, ...(readTime ? { readTime } : {}) })
        ids.push(...(r.collectionIds || []))
        pageToken = r.nextPageToken
      } while (pageToken)
      return ids
    },
    // showMissing: also documents that do not exist but have subcollections.
    async *listDocuments(parent, collectionId) {
      let pageToken
      do {
        const q = new URLSearchParams({ pageSize: '300', showMissing: 'true', ...(pageToken ? { pageToken } : {}), ...(readTime ? { readTime } : {}) })
        const r = await call('GET', `${parent}/${collectionId}?${q}`)
        for (const d of r.documents || []) yield d
        pageToken = r.nextPageToken
      } while (pageToken)
    },
    commit: (writes) => call('POST', `${root}:commit`, { writes }),
  }
}

/**
 * Walks every document at every depth: yields { path, fields|null }.
 * Subcollections are discovered for up to 16 documents at a time; order is
 * breadth-first by depth and not significant to callers.
 */
export async function* walk(c, { concurrency = 16, maxDepth = 20 } = {}) {
  let parents = [c.root]
  for (let depth = 0; parents.length && depth <= maxDepth; depth++) {
    const next = []
    // Collection ids for this level's parents, in parallel batches.
    for (let i = 0; i < parents.length; i += concurrency) {
      const batch = parents.slice(i, i + concurrency)
      const idsPer = await Promise.all(batch.map(p => c.listCollectionIds(p)))
      for (let j = 0; j < batch.length; j++) {
        for (const collectionId of idsPer[j]) {
          for await (const d of c.listDocuments(batch[j], collectionId)) {
            const path = d.name.slice(d.name.indexOf('/documents/') + '/documents/'.length)
            // A "missing" document has no createTime: it only holds subcollections.
            yield { path, fields: d.createTime ? (d.fields || {}) : null }
            next.push(d.name)
          }
        }
      }
    }
    parents = next
  }
}

// References point at a project and database; rewrite them for the target so
// a restored copy does not point back into the source.
export function rewriteRefs(value, from, to) {
  if (Array.isArray(value)) return value.map(v => rewriteRefs(v, from, to))
  if (value && typeof value === 'object') {
    if (typeof value.referenceValue === 'string') return { referenceValue: value.referenceValue.replace(from, to) }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteRefs(v, from, to)]))
  }
  return value
}

// Canonical form for hashing: keys sorted, references reduced to their
// document path, so a source and its restored copy hash equal.
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    if (typeof value.referenceValue === 'string') return { referenceValue: value.referenceValue.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, '') }
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  }
  return value
}
