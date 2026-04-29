import { useCallback, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function VerifyEmailToken() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  const [status, setStatus] = useState(token ? 'checking' : 'error') // 'checking' | 'success' | 'error'
  const [error, setError] = useState(token ? '' : 'Invalid link.')

  const verify = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'emailVerifications', token))
      if (!snap.exists()) { setStatus('error'); setError('This link is invalid or has already been used.'); return }
      const data = snap.data()
      if (data.used) { setStatus('error'); setError('This link has already been used.'); return }
      if (data.uid !== currentUser.uid) { setStatus('error'); setError('This link belongs to a different account.'); return }
      if (new Date(data.expiresAt) < new Date()) { setStatus('error'); setError('This link has expired. Request a new one.'); return }

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
      setError('Something went wrong. Try again.')
    }
  }, [currentUser, navigate, token])

  useEffect(() => {
    if (!token) return
    if (!currentUser) {
      // Not signed in — wait a moment in case auth is still loading
      const t = setTimeout(() => {
        setStatus('error')
        setError('Please sign in to verify your email.')
      }, 3000)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => { verify() }, 0)
    return () => clearTimeout(t)
  }, [token, currentUser, verify])

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

      <div className="auth-card">
        {status === 'checking' && (
          <>
            <div className="auth-eyebrow"><Loader2 size={14} className="spin" /><span>Verifying</span></div>
            <h1 className="auth-title">Checking your link...</h1>
            <p className="auth-subtitle">Just a second.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="auth-eyebrow" style={{ color: '#10b981' }}>
              <CheckCircle size={14} /><span>Verified</span>
            </div>
            <h1 className="auth-title">You're in!</h1>
            <p className="auth-subtitle">
              Your email is verified. Taking you to Zaman now...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="auth-eyebrow" style={{ color: '#ef4444' }}>
              <XCircle size={14} /><span>Problem</span>
            </div>
            <h1 className="auth-title">Couldn't verify</h1>
            <p className="auth-subtitle">{error}</p>
            <div className="auth-form" style={{ marginTop: 16 }}>
              <button className="settings-button auth-submit" style={{ justifyContent: 'center' }} onClick={() => navigate('/verify-email')}>
                Go back
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default VerifyEmailToken
