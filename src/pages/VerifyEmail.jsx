import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, RefreshCw } from 'lucide-react'
import { sendEmailVerification } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../AuthContext'

function VerifyEmail() {
  const { currentUser, logOut } = useAuth()
  const navigate = useNavigate()
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentUser) return
    if (currentUser.emailVerified) {
      redirectAfterVerify()
      return
    }
    const interval = setInterval(async () => {
      try {
        await currentUser.reload()
        if (auth.currentUser?.emailVerified) {
          clearInterval(interval)
          redirectAfterVerify()
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [currentUser])

  async function redirectAfterVerify() {
    try {
      const snap = await getDoc(doc(db, 'users', auth.currentUser.uid))
      if (snap.exists()) {
        const d = snap.data()
        navigate(d.accountType === 'employee' ? '/my-schedule' : d.onboarded ? '/dashboard' : '/onboarding')
      } else {
        navigate('/onboarding')
      }
    } catch {
      navigate('/dashboard')
    }
  }

  async function handleResend() {
    if (!currentUser) return
    setResending(true)
    setError('')
    try {
      await sendEmailVerification(currentUser)
      setSent(true)
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
        <motion.div className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <motion.div className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="auth-eyebrow">
          <Mail size={14} />
          <span>Check your inbox</span>
        </div>

        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">
          We sent a verification link to{' '}
          <strong>{currentUser?.email}</strong>.
          Click the link in that email to activate your account.
        </p>

        {sent && <div className="auth-success">Email sent — check your inbox (and spam).</div>}
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-form">
          <button
            className="settings-button auth-submit"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            style={{ justifyContent: 'center' }}
          >
            <RefreshCw size={14} />
            <span>
              {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? 'Sending...' : 'Resend verification email'}
            </span>
          </button>
        </div>

        <p className="auth-footer">
          Wrong account?{' '}
          <button className="link-button" onClick={handleSignOut}>Sign out</button>
        </p>
      </motion.div>
    </main>
  )
}

export default VerifyEmail
