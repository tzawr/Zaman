import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

function SignIn() {
  const navigate = useNavigate()
  const { signIn, signInWithGoogle } = useAuth()
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')

    try {
      setLoading(true)
      await signIn(email, password)
      navigate('/employees')
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setError('Invalid email or password')
      } else {
        setError('Failed to sign in. Try again.')
      }
      setLoading(false)
    }
  }

  async function handleGoogleSignIn() {
    setError('')
    try {
      setLoading(true)
      const result = await signInWithGoogle()
      
      // Check if user has completed onboarding
      const { doc, getDoc } = await import('firebase/firestore')
      const { db } = await import('../firebase')
      const userDoc = await getDoc(doc(db, 'users', result.user.uid))
      
      if (userDoc.exists() && userDoc.data().onboarded) {
        navigate('/employees')
      } else {
        navigate('/onboarding')
      }
    } catch (err) {
      console.error(err)
      setError('Google sign-in failed. Try again.')
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">Welcome back</h2>
        <p className="auth-subtitle">Sign in to your Zaman account.</p>

        {error && <div className="auth-error">{error}</div>}

        <button 
          className="google-button" 
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          <span className="google-icon">G</span>
          Continue with Google
        </button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <form onSubmit={handleSignIn} className="auth-form">
          <label className="auth-label">Email</label>
          <input
            type="email"
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label className="auth-label">Password</label>
          <input
            type="password"
            className="input"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button 
            type="submit" 
            className="auth-button"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="auth-footer">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </main>
  )
}

export default SignIn