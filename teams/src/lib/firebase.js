import { initializeApp, getApps } from 'firebase/app'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectAuthEmulator } from 'firebase/auth'
import { createAuth } from './authPersistence'

// The same Firebase project as Hengam, so one account works in both.

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
}

export const usingEmulators = process.env.EXPO_PUBLIC_USE_EMULATORS === '1'

const firstLoad = getApps().length === 0
export const app = firstLoad ? initializeApp(config) : getApps()[0]
export const auth = createAuth(app)
export const db = getFirestore(app)

// Only ever against a demo- project, so a leftover flag cannot send a
// production build's traffic to localhost or the other way round.
if (firstLoad && usingEmulators && String(config.projectId).startsWith('demo-')) {
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST || '127.0.0.1'
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8085)
}
