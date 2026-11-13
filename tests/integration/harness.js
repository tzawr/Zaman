import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// Integration tests drive the real HTTP handlers in api/ through
// scripts/dev-api.js, the same routing Vercel does, against the Auth and
// Firestore emulators. Nothing here can reach a real project: the project id
// is demo-*, which _firebase-admin.js insists on whenever an emulator host is
// set, and the hosts below are loopback only.

export const PROJECT_ID = 'demo-hengam'
export const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'
export const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'

for (const host of [FIRESTORE, AUTH]) {
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) {
    throw new Error(`Refusing to run integration tests against non-loopback emulator host ${host}`)
  }
}

const root = resolve(import.meta.dirname, '../..')

/** Starts scripts/dev-api.js on a free port; resolves to { url, stop }. */
export async function startApi(extraEnv = {}) {
  // 3659 is on the fetch standard's blocked-port list (fetch refuses it with
  // "bad port"), and it falls inside this range.
  let port
  do port = 3400 + Math.floor(Math.random() * 500)
  while (port === 3659)
  const child = spawn(process.execPath, ['scripts/dev-api.js'], {
    cwd: root,
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: FIRESTORE,
      FIREBASE_AUTH_EMULATOR_HOST: AUTH,
      GCLOUD_PROJECT: PROJECT_ID,
      PORT: String(port),
      // Never inherit a real key into a test server.
      ANTHROPIC_API_KEY: 'test-key-not-real',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stderr.on('data', d => { log += d })
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`dev-api did not start:\n${log}`)), 10000)
    child.stdout.on('data', d => {
      log += d
      if (String(d).includes('api on')) { clearTimeout(timer); ok() }
    })
    child.on('exit', code => { clearTimeout(timer); fail(new Error(`dev-api exited ${code}:\n${log}`)) })
  })
  return {
    url: `http://127.0.0.1:${port}`,
    log: () => log,
    stop: () => new Promise(done => { child.removeAllListeners('exit'); child.on('exit', done); child.kill() }),
  }
}

export async function clearFirestore() {
  await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
}

export async function clearAuth() {
  await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' })
}

/** Creates an emulator account and returns a real (emulator-signed) ID token. */
export async function signUp(email = `u${Math.random().toString(36).slice(2, 10)}@example.test`) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-pass-123', returnSecureToken: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`signUp failed: ${JSON.stringify(body)}`)
  return { uid: body.localId, idToken: body.idToken, email }
}

export async function post(api, path, { token, body = {}, headers = {} } = {}) {
  const res = await fetch(`${api.url}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* empty body */ }
  return { status: res.status, headers: res.headers, body: json }
}
