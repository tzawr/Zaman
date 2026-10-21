import { Platform } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import { GoogleAuthProvider, OAuthProvider, reauthenticateWithCredential, signInWithCredential, updateProfile } from 'firebase/auth'
import { auth } from './firebase'

// Native: each provider's own SDK signs in, and the identity token it returns
// is exchanged for a Firebase session.

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

// Google needs client ids from the Firebase console, and a development build
// (it is not in Expo Go). Without them the button is not offered at all.
export const googleAvailable = Boolean(webClientId && (Platform.OS !== 'ios' || iosClientId))

let googleConfigured = false
async function googleCredential() {
  // Loaded on demand so a build without the native module still starts.
  const { GoogleSignin, isSuccessResponse } = await import('@react-native-google-signin/google-signin')
  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId, iosClientId })
    googleConfigured = true
  }
  if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
  const response = await GoogleSignin.signIn()
  if (!isSuccessResponse(response)) {
    const cancelled = new Error('cancelled')
    cancelled.code = 'auth/cancelled'
    throw cancelled
  }
  const idToken = response.data.idToken
  if (!idToken) throw new Error('Google did not return an identity token.')
  return GoogleAuthProvider.credential(idToken)
}

export async function signInWithGoogle() {
  return signInWithCredential(auth, await googleCredential())
}

// Off in builds signed without the Sign in with Apple capability.
export async function appleAvailable() {
  return Platform.OS === 'ios' && Constants.expoConfig?.extra?.appleSignIn !== false &&
    AppleAuthentication.isAvailableAsync()
}

// Firebase checks that Apple's token was minted for the nonce it is given, so
// a token intercepted from another sign-in cannot be replayed here.
async function appleCredential() {
  const rawNonce = Crypto.randomUUID() + Crypto.randomUUID()
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce)
  let result
  try {
    result = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    })
  } catch (err) {
    if (err?.code === 'ERR_REQUEST_CANCELED') {
      const cancelled = new Error('cancelled')
      cancelled.code = 'auth/cancelled'
      throw cancelled
    }
    throw err
  }
  const provider = new OAuthProvider('apple.com')
  return { credential: provider.credential({ idToken: result.identityToken, rawNonce }), result }
}

export async function signInWithApple() {
  const { credential, result } = await appleCredential()
  const cred = await signInWithCredential(auth, credential)
  // Apple sends the name only on the very first sign-in, and never in the
  // token, so it is saved now or not at all.
  const name = [result.fullName?.givenName, result.fullName?.familyName].filter(Boolean).join(' ')
  if (name && !cred.user.displayName) await updateProfile(cred.user, { displayName: name }).catch(() => {})
  return cred
}

// Proving it is still the same person, before something irreversible.
// Firebase refuses a different account with auth/user-mismatch.
export async function reauthenticate(providerId) {
  const credential = providerId === 'apple.com' ? (await appleCredential()).credential : await googleCredential()
  return reauthenticateWithCredential(auth.currentUser, credential)
}
