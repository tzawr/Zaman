import AsyncStorage from '@react-native-async-storage/async-storage'
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth'

// Without explicit persistence the native SDK keeps the session in memory and
// signs the user out every time the app is closed.
export function createAuth(app) {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  } catch {
    // Fast refresh re-runs this module after auth already exists.
    return getAuth(app)
  }
}
