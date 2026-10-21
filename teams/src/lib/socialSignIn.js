import { GoogleAuthProvider, OAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from './firebase'

// Web: both providers run through Firebase's popup.

export const googleAvailable = true
export const appleAvailable = async () => process.env.EXPO_PUBLIC_APPLE_WEB === '1'

export async function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider())
}

export async function signInWithApple() {
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  return signInWithPopup(auth, provider)
}
