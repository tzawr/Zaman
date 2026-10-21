import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword, onIdTokenChanged, reload, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile,
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { forgetDevice } from '../lib/push'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined while Firebase restores the saved session.
  const [user, setUser] = useState(undefined)
  // Bumped when the user object changes in place (a reload after verifying
  // email mutates it), so consumers re-render.
  const [version, setVersion] = useState(0)

  useEffect(() => onIdTokenChanged(auth, (next) => {
    setUser(next)
    setVersion(v => v + 1)
  }), [])

  const signUp = useCallback(async ({ name, email, password }) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
    if (name) await updateProfile(cred.user, { displayName: name.trim() })
    await sendEmailVerification(cred.user).catch(() => {})
    setVersion(v => v + 1)
    return cred.user
  }, [])

  const signIn = useCallback(({ email, password }) =>
    signInWithEmailAndPassword(auth, email.trim(), password), [])

  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email.trim()), [])

  const resendVerification = useCallback(() => sendEmailVerification(auth.currentUser), [])

  // Pulls the latest emailVerified, and mints a fresh token so the server
  // sees it too.
  const refreshUser = useCallback(async () => {
    if (!auth.currentUser) return null
    await reload(auth.currentUser)
    await auth.currentUser.getIdToken(true)
    setVersion(v => v + 1)
    return auth.currentUser
  }, [])

  // This phone stops getting the account's notifications first; that needs
  // the account still signed in. A failure there must not block signing out.
  const signOut = useCallback(async () => {
    if (auth.currentUser) await forgetDevice(auth.currentUser.uid).catch(() => {})
    return firebaseSignOut(auth)
  }, [])

  const value = useMemo(() => ({
    user, loading: user === undefined, version,
    signUp, signIn, resetPassword, resendVerification, refreshUser, signOut,
  }), [user, version, signUp, signIn, resetPassword, resendVerification, refreshUser, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

// Accounts from Google or Apple arrive verified; only email sign-ups need it.
export function needsVerification(user) {
  return Boolean(user && !user.emailVerified && user.providerData.some(p => p.providerId === 'password'))
}
