import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export function initAdmin() {
  if (getApps().length) return
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (serviceAccountJson) {
    initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) })
    return
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin credentials are not configured')
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
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
  return res.status(status).json({
    blocked: true,
    reason: status === 403 ? 'admin_required' : status === 401 ? 'auth_required' : 'server_error',
    message: err.message || fallback,
  })
}
