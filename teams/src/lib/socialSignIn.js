import { GoogleAuthProvider, OAuthProvider, reauthenticateWithPopup, signInWithPopup } from 'firebase/auth'
import { auth } from './firebase'

// Web: both providers run through Firebase's popup.

export const googleAvailable = true
export const appleAvailable = async () => process.env.EXPO_PUBLIC_APPLE_WEB === '1'

export async function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider())
}

function appleProvider() {
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  return provider
}

export async function signInWithApple() {
  return signInWithPopup(auth, appleProvider())
}

// Proving it is still the same person, before something irreversible.
// Firebase refuses a different account with auth/user-mismatch.
export async function reauthenticate(providerId) {
  const provider = providerId === 'apple.com' ? appleProvider() : new GoogleAuthProvider()
  return reauthenticateWithPopup(auth.currentUser, provider)
}
