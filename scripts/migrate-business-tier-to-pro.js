import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

function initAdmin() {
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

initAdmin()
const db = getFirestore()
const snap = await db.collection('users').where('tier', '==', 'business').get()
const batch = db.batch()
snap.docs.forEach(userDoc => batch.update(userDoc.ref, { tier: 'pro' }))
await batch.commit()
console.log(`Migrated ${snap.size} business-tier users to pro.`)
