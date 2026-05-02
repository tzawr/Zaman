import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { ArrowRight, Mail } from 'lucide-react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase'
import { useI18n } from '../i18n'

function ForgotPassword() {
  const { t } = useI18n()
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
      setError(prettyError(err.code, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-bg">
        <Motion.div
          className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Motion.div
          className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <Motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="auth-eyebrow">
          <Mail size={14} />
          <span>{t('resetEyebrow')}</span>
        </div>

        {!sent ? (
          <>
            <h1 className="auth-title">
              {t('resetTitle')} <span className="landing-gradient-text">{t('resetTitleTail')}</span>
            </h1>
            <p className="auth-subtitle">
              {t('resetSubtitle')}
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label className="form-label">{t('email')}</label>
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
                <span>{loading ? t('sending') : t('sendReset')}</span>
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="auth-title">{t('checkInbox')}</h1>
            <p className="auth-subtitle">
              {t('resetSent')} <strong>{email}</strong>. {t('resetSentTail')}
            </p>
            <div className="auth-success" style={{ marginTop: 8 }}>
              {t('resetSpam')}
            </div>
            <div className="auth-form" style={{ marginTop: 8 }}>
              <button
                className="settings-button auth-submit"
                onClick={() => { setSent(false); setEmail('') }}
                style={{ justifyContent: 'center' }}
              >
                {t('differentEmail')}
              </button>
            </div>
          </>
        )}

        <p className="auth-footer">
          <Link to="/signin">{t('backToSignIn')}</Link>
        </p>
      </Motion.div>
    </main>
  )
}

function prettyError(code, t) {
  const map = {
    'auth/invalid-email': t('authInvalidEmail'),
    'auth/user-not-found': t('authUserNotFound'),
    'auth/too-many-requests': t('authTooMany'),
  }
  return map[code] || t('authGeneric')
}

export default ForgotPassword
