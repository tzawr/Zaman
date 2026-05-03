import { useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { Mail, RefreshCw } from 'lucide-react'
import { sendEmailVerification } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'

function VerifyEmail() {
  const { currentUser, logOut } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const redirectAfterVerify = useCallback(async () => {
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
  }, [navigate])

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
      } catch {
        // Keep polling; transient reload failures should not block verification.
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [currentUser, redirectAfterVerify])

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
      setError(t('verifyResendError'))
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
        <Motion.div className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
        <Motion.div className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />
      </div>

      <Motion.div className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="auth-eyebrow">
          <Mail size={14} />
          <span>{t('verifyInbox')}</span>
        </div>

        <h1 className="auth-title">{t('verifyTitle')}</h1>
        <p className="auth-subtitle">
          {t('verifySubtitleBefore')}{' '}
          <strong>{currentUser?.email}</strong>.
          {' '}{t('verifySubtitleAfter')}
        </p>

        {sent && <div className="auth-success">{t('verifySent')}</div>}
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
              {cooldown > 0 ? `${t('verifyResendIn')} ${cooldown}s` : resending ? t('verifySending') : t('verifyResend')}
            </span>
          </button>
        </div>

        <p className="auth-footer">
          {t('verifyWrongAccount')}{' '}
          <button className="link-button" onClick={handleSignOut}>{t('verifySignOut')}</button>
        </p>
      </Motion.div>
    </main>
  )
}

export default VerifyEmail
