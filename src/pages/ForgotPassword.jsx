import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { ArrowRight, Mail } from 'lucide-react'
import { reportError } from '../utils/reportError'
import { EXPECTED_AUTH_ERRORS, authErrorMessage } from '../utils/authErrors'
import { useI18n } from '../i18n'
import { requestPasswordReset } from '../utils/authEmails'

function ForgotPassword() {
  const { t, language } = useI18n()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await requestPasswordReset(email, language)
      setSent(true)
    } catch (err) {
      if (!EXPECTED_AUTH_ERRORS.has(err?.code)) reportError('auth.reset', err)
      setError(authErrorMessage(err?.code, t))
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
                <label htmlFor="forgotpassword-email" className="form-label">{t('email')}</label>
                <input
                  id="forgotpassword-email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              {error && <div className="auth-error" role="alert">{error}</div>}

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

export default ForgotPassword
