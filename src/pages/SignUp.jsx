import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Sparkles, Check } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'

function SignUp() {
  const navigate = useNavigate()
  const { signUp, signInWithGoogle } = useAuth()
  const toast = useToast()
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    try {
      await signUp(email, password)
      navigate('/onboarding')
    } catch (err) {
      setError(prettyError(err.code))
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError('')
    setLoading(true)
    try {
      await signInWithGoogle()
      navigate('/dashboard')
    } catch (err) {
      setError(prettyError(err.code))
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-bg">
        <motion.div 
          className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="auth-eyebrow">
          <Sparkles size={14} />
          <span>Get started — free</span>
        </div>
        
        <h1 className="auth-title">
          Create your <span className="landing-gradient-text">Zaman</span> account
        </h1>
        <p className="auth-subtitle">
          Build better schedules in minutes.
        </p>

        <div className="auth-perks">
          <div className="auth-perk"><Check size={14} /> Free forever plan</div>
          <div className="auth-perk"><Check size={14} /> No credit card</div>
          <div className="auth-perk"><Check size={14} /> 2-min setup</div>
        </div>

        <button 
          type="button"
          className="google-auth-btn"
          onClick={handleGoogle}
          disabled={loading}
        >
          <GoogleIcon />
          <span>Continue with Google</span>
        </button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="input"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={6}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button 
            type="submit"
            className="landing-cta-primary auth-submit"
            disabled={loading}
          >
            <span>{loading ? 'Creating account...' : 'Create account'}</span>
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      </motion.div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

function prettyError(code) {
  const map = {
    'auth/email-already-in-use': 'That email already has an account.',
    'auth/invalid-email': 'That email looks wrong.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  }
  return map[code] || 'Something went wrong. Try again.'
}

export default SignUp