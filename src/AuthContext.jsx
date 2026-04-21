import { createContext, useContext, useEffect, useState } from 'react'
import { 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth'
import { auth, googleProvider } from './firebase'

const AuthContext = createContext()

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Listen for auth state changes (login, logout, session restore)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  // Sign up with email/password
  async function signUp(email, password) {
    return createUserWithEmailAndPassword(auth, email, password)
  }

  // Sign in with email/password
  async function signIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password)
  }

  // Sign in with Google
  async function signInWithGoogle() {
    return signInWithPopup(auth, googleProvider)
  }

  // Sign out
  async function logOut() {
    return signOut(auth)
  }

  const value = {
    currentUser,
    signUp,
    signIn,
    signInWithGoogle,
    logOut
  }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}