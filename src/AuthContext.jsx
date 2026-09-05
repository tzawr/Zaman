/* eslint-disable react-refresh/only-export-components -- useAuth is intentionally co-located with AuthProvider */
import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, googleProvider, db } from './firebase'

const AuthContext = createContext()

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [userData, setUserData] = useState(undefined) // undefined = loading
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user)
      if (!user) {
        setUserData(null)
        setLoading(false)
      }
    })
    return unsub
  }, [])

  // Load Firestore user doc whenever auth user changes
  useEffect(() => {
    if (!currentUser) return
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      const data = snap.exists() ? snap.data() : null
      // 'business' is the old name for the Pro plan. Read it as Pro rather than
      // rewriting the document — tier is not user-writable.
      setUserData(data?.tier === 'business' ? { ...data, tier: 'pro' } : data)
      setLoading(false)
    })
    return () => unsub()
  }, [currentUser])

  async function signUp(email, password) {
    return createUserWithEmailAndPassword(auth, email, password)
  }

  async function signIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password)
  }

  async function signInWithGoogle() {
    return signInWithPopup(auth, googleProvider)
  }

  async function logOut() {
    return signOut(auth)
  }

  const value = {
    currentUser,
    userData,
    signUp,
    signIn,
    signInWithGoogle,
    logOut,
  }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}
