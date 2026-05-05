import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function normalizePrivateKey(value) {
  if (!value) return ''
  let key = String(value).trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  key = key
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
  if (!key.includes('BEGIN PRIVATE KEY')) {
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8').trim()
      if (decoded.includes('BEGIN PRIVATE KEY')) {
        key = decoded
          .replace(/\\\\n/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\r\n/g, '\n')
      }
    } catch {
      // Keep the original value so Firebase Admin can report the credential issue.
    }
  }
  return key
}

function parseServiceAccountJson(value) {
  const parsed = JSON.parse(value)
  if (parsed.private_key) parsed.private_key = normalizePrivateKey(parsed.private_key)
  return parsed
}

export function initAdmin() {
  if (getApps().length) return
  const credentialAttempts = []
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64
    if (serviceAccountBase64) {
      credentialAttempts.push({
        name: 'FIREBASE_SERVICE_ACCOUNT_KEY_BASE64',
        getCredential: () => {
          const json = Buffer.from(serviceAccountBase64, 'base64').toString('utf8')
          return cert(parseServiceAccountJson(json))
        },
      })
    }
    if (serviceAccountJson) {
      credentialAttempts.push({
        name: 'FIREBASE_SERVICE_ACCOUNT_KEY',
        getCredential: () => cert(parseServiceAccountJson(serviceAccountJson)),
      })
    }
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY)
    if (projectId && clientEmail && privateKey) {
      credentialAttempts.push({
        name: 'FIREBASE_PRIVATE_KEY',
        getCredential: () => cert({ projectId, clientEmail, privateKey }),
      })
    }
    if (!credentialAttempts.length) {
      throw new Error('Firebase Admin credentials are not configured')
    }

    const failures = []
    for (const attempt of credentialAttempts) {
      try {
        initializeApp({ credential: attempt.getCredential() })
        return
      } catch (err) {
        failures.push(`${attempt.name}: ${err.message}`)
      }
    }
    throw new Error(failures.join(' | '))
  } catch (err) {
    const error = new Error(
      'Firebase Admin credentials are invalid on Vercel. Re-check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 or FIREBASE_PRIVATE_KEY in the Production environment, then redeploy.'
    )
    error.status = 500
    error.code = 'firebase_admin_config'
    error.detail = err.message
    throw error
  }
}

export function adminDb() {
  initAdmin()
  return getFirestore()
}

export function adminAuth() {
  initAdmin()
  return getAuth()
}

export function serverAdminUids() {
  return String(process.env.ADMIN_UIDS || '')
    .split(',')
    .map(uid => uid.trim())
    .filter(Boolean)
}

export async function requireServerAdmin(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    const error = new Error('Missing auth token')
    error.status = 401
    throw error
  }
  const decoded = await adminAuth().verifyIdToken(token)
  if (!serverAdminUids().includes(decoded.uid)) {
    const error = new Error('Admin access required')
    error.status = 403
    throw error
  }
  return decoded
}

export async function requireSignedIn(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    const error = new Error('Missing auth token')
    error.status = 401
    throw error
  }
  return adminAuth().verifyIdToken(token)
}

export function sendError(res, err, fallback = 'Server error') {
  const status = err.status || 500
  const reason = err.code === 'firebase_admin_config'
    ? 'firebase_admin_config'
    : status === 403
      ? 'admin_required'
      : status === 401
        ? 'auth_required'
        : 'server_error'
  return res.status(status).json({
    blocked: true,
    reason,
    message: err.message || fallback,
    detail: err.detail || undefined,
  })
}
