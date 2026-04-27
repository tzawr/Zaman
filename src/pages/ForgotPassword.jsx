import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Mail } from 'lucide-react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase'

function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, email)
      setSent(true)
    } catch (err) {
      setError(prettyError(err.code))
    } finally {
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
          <Mail size={14} />
          <span>Password reset</span>
        </div>

        {!sent ? (
          <>
            <h1 className="auth-title">
              Forgot your <span className="landing-gradient-text">password?</span>
            </h1>
            <p className="auth-subtitle">
              Enter your email and we'll send you a reset link.
            </p>

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

              {error && <div className="auth-error">{error}</div>}

              <button
                type="submit"
                className="landing-cta-primary auth-submit"
                disabled={loading}
              >
                <span>{loading ? 'Sending...' : 'Send reset link'}</span>
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="auth-title">Check your inbox</h1>
            <p className="auth-subtitle">
              We sent a password reset link to <strong>{email}</strong>. Click the link in that email to set a new password.
            </p>
            <div className="auth-success" style={{ marginTop: 8 }}>
              Didn't get it? Check your spam folder or try again below.
            </div>
            <div className="auth-form" style={{ marginTop: 8 }}>
              <button
                className="settings-button auth-submit"
                onClick={() => { setSent(false); setEmail('') }}
                style={{ justifyContent: 'center' }}
              >
                Try a different email
              </button>
            </div>
          </>
        )}

        <p className="auth-footer">
          <Link to="/signin">Back to sign in</Link>
        </p>
      </motion.div>
    </main>
  )
}

function prettyError(code) {
  const map = {
    'auth/invalid-email': 'That email address looks wrong.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  }
  return map[code] || 'Something went wrong. Try again.'
}

export default ForgotPassword
