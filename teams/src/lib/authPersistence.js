import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth'

export function createAuth(app) {
  const auth = getAuth(app)
  setPersistence(auth, browserLocalPersistence).catch(() => {})
  return auth
}
