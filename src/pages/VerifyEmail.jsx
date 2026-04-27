import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, ArrowRight, RefreshCw } from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function VerifyEmail() {
  const { currentUser, sendVerificationEmail, logOut } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')

  async function handleContinue() {
    setChecking(true)
    setError('')
    try {
      await currentUser.reload()
      if (currentUser.emailVerified) {
        // Redirect based on account type
        const snap = await getDoc(doc(db, 'users', currentUser.uid))
        if (snap.exists()) {
          const data = snap.data()
          if (!data.onboarded) { navigate('/onboarding'); return }
          navigate(data.accountType === 'employee' ? '/my-schedule' : '/dashboard')
        } else {
          navigate('/onboarding')
        }
      } else {
        setError("Email not verified yet. Check your inbox and click the link, then try again.")
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setChecking(false)
    }
  }

  async function handleResend() {
    setResending(true)
    setError('')
    try {
      await sendVerificationEmail()
      setCooldown(60)
      const interval = setInterval(() => {
        setCooldown(c => {
          if (c <= 1) { clearInterval(interval); return 0 }
          return c - 1
        })
      }, 1000)
    } catch {
      setError('Failed to resend. Try again in a moment.')
    } finally {
      setResending(false)
    }
  }

  async function handleSignOut() {
    await logOut()
    navigate('/')
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
          <span>Verify your email</span>
        </div>

        <h1 className="auth-title">Check your inbox</h1>
        <p className="auth-subtitle">
          We sent a verification link to{' '}
          <strong>{currentUser?.email}</strong>.
          Click it to activate your account.
        </p>

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-form">
          <button
            className="landing-cta-primary auth-submit"
            onClick={handleContinue}
            disabled={checking}
          >
            <span>{checking ? 'Checking...' : "I've verified my email"}</span>
            {!checking && <ArrowRight size={16} />}
          </button>

          <button
            className="settings-button auth-submit"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            style={{ justifyContent: 'center' }}
          >
            <RefreshCw size={14} />
            <span>
              {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? 'Sending...' : 'Resend email'}
            </span>
          </button>
        </div>

        <p className="auth-footer">
          Wrong account?{' '}
          <button className="link-button" onClick={handleSignOut}>
            Sign out
          </button>
        </p>
      </motion.div>
    </main>
  )
}

export default VerifyEmail
