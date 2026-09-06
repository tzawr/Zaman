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
  // A PEM key pasted into a single-line form loses its line breaks, which makes
  // it invalid even though every character is present. Rebuild the wrapping
  // from the body rather than making the operator paste it a different way.
  const pem = key.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/)
  if (pem) {
    const body = pem[2].replace(/\s+/g, '')
    const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? ''
    return `-----BEGIN ${pem[1]}-----\n${wrapped}\n-----END ${pem[1]}-----\n`
  }

  if (!key.includes('BEGIN PRIVATE KEY')) {
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8').trim()
      if (decoded.includes('BEGIN PRIVATE KEY')) {
        key = decoded
          .replace(/\\\\n/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\r\n/g, '\n')
        return normalizePrivateKey(key)
      }
      // The whole service-account JSON pasted into the key field.
      if (decoded.includes('"private_key"')) {
        const parsed = JSON.parse(decoded)
        if (parsed.private_key) return normalizePrivateKey(parsed.private_key)
      }
    } catch {
      // Keep the original value so Firebase Admin can report the credential issue.
    }
  }

  // The service-account JSON pasted in directly, not base64.
  if (key.startsWith('{')) {
    try {
      const parsed = JSON.parse(key)
      if (parsed.private_key) return normalizePrivateKey(parsed.private_key)
    } catch {
      // Fall through and let Firebase Admin report it.
    }
  }

  // Just the key body, with the BEGIN/END lines left behind when it was copied.
  // Everything needed is there, so put the envelope back.
  if (!key.includes('BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(key) && key.replace(/\s+/g, '').length > 600) {
    const body = key.replace(/\s+/g, '')
    const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? ''
    return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`
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
  let decoded
  try {
    decoded = await adminAuth().verifyIdToken(token)
  } catch (err) {
    if (err?.code === 'firebase_admin_config') throw err
    const error = new Error('Invalid or expired session. Sign in again.')
    error.status = 401
    throw error
  }
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
  try {
    return await adminAuth().verifyIdToken(token)
  } catch (err) {
    // A malformed or expired token is a rejected caller, not a server fault.
    // Reported as 401 without echoing the verifier's internals.
    if (err?.code === 'firebase_admin_config') throw err
    const error = new Error('Invalid or expired session. Sign in again.')
    error.status = 401
    throw error
  }
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
