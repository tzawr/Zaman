/* eslint-disable react-refresh/only-export-components -- useAuth is intentionally co-located with AuthProvider */
import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
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
      if (data?.tier === 'business') {
        updateDoc(doc(db, 'users', currentUser.uid), { tier: 'pro' }).catch(() => {})
        setUserData({ ...data, tier: 'pro' })
      } else {
        setUserData(data)
      }
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
