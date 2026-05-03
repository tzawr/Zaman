import { useCallback, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'

function VerifyEmailToken() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { t } = useI18n()

  const [status, setStatus] = useState(token ? 'checking' : 'error') // 'checking' | 'success' | 'error'
  const [errorKey, setErrorKey] = useState(token ? '' : 'verifyInvalidLink')

  const verify = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'emailVerifications', token))
      if (!snap.exists()) { setStatus('error'); setErrorKey('verifyInvalidUsed'); return }
      const data = snap.data()
      if (data.used) { setStatus('error'); setErrorKey('verifyUsed'); return }
      if (data.uid !== currentUser.uid) { setStatus('error'); setErrorKey('verifyDifferentAccount'); return }
      if (new Date(data.expiresAt) < new Date()) { setStatus('error'); setErrorKey('verifyExpired'); return }

      // Mark verified in Firestore user doc
      await setDoc(doc(db, 'users', currentUser.uid), { emailVerified: true }, { merge: true })
      await updateDoc(doc(db, 'emailVerifications', token), { used: true })

      setStatus('success')

      // Redirect after 2 seconds
      setTimeout(async () => {
        const userSnap = await getDoc(doc(db, 'users', currentUser.uid))
        if (userSnap.exists()) {
          const d = userSnap.data()
          if (!d.onboarded) { navigate('/onboarding'); return }
          navigate(d.accountType === 'employee' ? '/my-schedule' : '/dashboard')
        } else {
          navigate('/onboarding')
        }
      }, 2000)
    } catch (err) {
      console.error(err)
      setStatus('error')
      setErrorKey('authGeneric')
    }
  }, [currentUser, navigate, token])

  useEffect(() => {
    if (!token) return
    if (!currentUser) {
      // Not signed in — wait a moment in case auth is still loading
      const t = setTimeout(() => {
        setStatus('error')
        setErrorKey('verifySignInNeeded')
      }, 3000)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => { verify() }, 0)
    return () => clearTimeout(t)
  }, [token, currentUser, verify])

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

      <div className="auth-card">
        {status === 'checking' && (
          <>
            <div className="auth-eyebrow"><Loader2 size={14} className="spin" /><span>{t('verifyChecking')}</span></div>
            <h1 className="auth-title">{t('verifyCheckingTitle')}</h1>
            <p className="auth-subtitle">{t('verifyJustSecond')}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="auth-eyebrow" style={{ color: '#10b981' }}>
              <CheckCircle size={14} /><span>{t('verifyVerified')}</span>
            </div>
            <h1 className="auth-title">{t('verifySuccessTitle')}</h1>
            <p className="auth-subtitle">
              {t('verifySuccessCopy')}
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="auth-eyebrow" style={{ color: '#ef4444' }}>
              <XCircle size={14} /><span>{t('verifyProblem')}</span>
            </div>
            <h1 className="auth-title">{t('verifyErrorTitle')}</h1>
            <p className="auth-subtitle">{t(errorKey)}</p>
            <div className="auth-form" style={{ marginTop: 16 }}>
              <button className="settings-button auth-submit" style={{ justifyContent: 'center' }} onClick={() => navigate('/verify-email')}>
                {t('verifyGoBack')}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default VerifyEmailToken
