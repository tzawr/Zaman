import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, KeyRound, Loader2, MailCheck } from 'lucide-react'
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { auth } from '../firebase'
import { useI18n } from '../i18n'
import { authErrorMessage } from '../utils/authErrors'
import { requestPasswordReset } from '../utils/authEmails'
import { reportError } from '../utils/reportError'

// HENGAM's handler for the links in verification, password-reset and
// email-change emails (Firebase's documented custom email action handler).
// The link carries mode, oobCode and lang; Firebase checks the code.

const LINK_ERRORS = new Set(['auth/expired-action-code', 'auth/invalid-action-code'])

function AuthAction() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t, tf, language, setLanguage } = useI18n()
  const mode = params.get('mode')
  const code = params.get('oobCode') || ''
  const next = (() => { const c = params.get('continue') || ''; return c.startsWith('/') && !c.startsWith('//') ? c : '/dashboard' })()
  const [state, setState] = useState({ step: 'working' })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const started = useRef(false)
  const headingRef = useRef(null)

  // The email's language wins on first load.
  useEffect(() => {
    const l = params.get('lang')
    if ((l === 'fa' || l === 'en') && l !== language) setLanguage(l)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    const fail = (err) => {
      if (!LINK_ERRORS.has(err?.code)) reportError(`auth.action.${mode || 'none'}`, err)
      setState({ step: 'error', expired: LINK_ERRORS.has(err?.code), message: LINK_ERRORS.has(err?.code) ? '' : authErrorMessage(err?.code, t) })
    }
    if (!code || !['verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail'].includes(mode)) {
      setState({ step: 'error', expired: false, message: t('authActionBadLink') })
      return
    }
    if (mode === 'resetPassword') {
      verifyPasswordResetCode(auth, code).then(email => setState({ step: 'newPassword', email })).catch(fail)
    } else if (mode === 'recoverEmail') {
      checkActionCode(auth, code)
        .then(info => applyActionCode(auth, code).then(() => setState({ step: 'done', kind: 'recovered', email: info.data.email })))
        .catch(fail)
    } else {
      applyActionCode(auth, code)
        .then(async () => {
          await auth.currentUser?.reload().catch(() => {})
          setState({ step: 'done', kind: mode === 'verifyEmail' ? 'verified' : 'emailChanged' })
        })
        .catch(fail)
    }
  }, [code, mode, t])

  useEffect(() => { headingRef.current?.focus() }, [state.step])

  async function savePassword(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await confirmPasswordReset(auth, code, password)
      setState({ step: 'done', kind: 'passwordReset', email: state.email })
    } catch (err) {
      if (LINK_ERRORS.has(err?.code)) setState({ step: 'error', expired: true, message: '' })
      else setState(s => ({ ...s, formError: authErrorMessage(err?.code, t) }))
    } finally {
      setBusy(false)
    }
  }

  async function newResetLink() {
    if (!state.email) return navigate('/forgot-password')
    setBusy(true)
    await requestPasswordReset(state.email, language).catch(() => {})
    setBusy(false)
    setState(s => ({ ...s, resent: true }))
  }

  const done = {
    verified: [t('authActionVerifiedTitle'), t('authActionVerifiedBody')],
    emailChanged: [t('authActionEmailChangedTitle'), t('authActionEmailChangedBody')],
    passwordReset: [t('authActionResetDoneTitle'), t('authActionResetDoneBody')],
    recovered: [t('authActionRecoveredTitle'), tf('authActionRecoveredBody', { email: state.email || '' })],
  }[state.kind] || []

  return (
    <main className="auth-page" dir={language === 'fa' ? 'rtl' : 'ltr'} lang={language}>
      <div className="auth-card auth-action-card" aria-live="polite">
        {state.step === 'working' && (
          <div className="auth-action-status">
            <Loader2 size={28} className="spin" aria-hidden />
            <h1 ref={headingRef} tabIndex={-1} className="auth-title">{t('authActionWorking')}</h1>
          </div>
        )}

        {state.step === 'newPassword' && (
          <form onSubmit={savePassword} className="auth-form">
            <div className="auth-eyebrow"><KeyRound size={14} aria-hidden /><span>{t('resetEyebrow')}</span></div>
            <h1 ref={headingRef} tabIndex={-1} className="auth-title">{t('authActionNewPasswordTitle')}</h1>
            <p className="auth-subtitle">{tf('authActionNewPasswordFor', { email: state.email })}</p>
            <label htmlFor="auth-action-password" className="form-label">{t('authActionNewPasswordLabel')}</label>
            <input id="auth-action-password" type="password" className="input" autoComplete="new-password" required minLength={6}
              aria-describedby="auth-action-password-hint" value={password} onChange={e => setPassword(e.target.value)} />
            <p id="auth-action-password-hint" className="auth-field-hint">{t('passwordMinHint')}</p>
            {state.formError && <div className="auth-error" role="alert">{state.formError}</div>}
            <button type="submit" className="landing-cta-primary auth-submit" disabled={busy || password.length < 6}>
              {busy ? t('saving') : t('authActionSavePassword')}
            </button>
          </form>
        )}

        {state.step === 'done' && (
          <div className="auth-action-status">
            <CheckCircle2 size={32} className="auth-action-ok" aria-hidden />
            <h1 ref={headingRef} tabIndex={-1} className="auth-title">{done[0]}</h1>
            <p className="auth-subtitle">{done[1]}</p>
            {state.kind === 'recovered' && (
              <button type="button" className="landing-cta-primary auth-submit" onClick={newResetLink} disabled={busy || state.resent}>
                {state.resent ? t('authActionResetSent') : t('authActionResetToo')}
              </button>
            )}
            <Link className="landing-cta-primary auth-submit auth-action-continue" to={state.kind === 'verified' || state.kind === 'emailChanged' ? next : '/signin'}>
              {state.kind === 'verified' ? t('authActionContinue') : t('signIn')}
            </Link>
          </div>
        )}

        {state.step === 'error' && (
          <div className="auth-action-status">
            <AlertTriangle size={30} className="auth-action-warn" aria-hidden />
            <h1 ref={headingRef} tabIndex={-1} className="auth-title">{state.expired ? t('authActionExpiredTitle') : t('authActionFailedTitle')}</h1>
            <p className="auth-subtitle">{state.expired ? t('authActionExpiredBody') : (state.message || t('authActionBadLink'))}</p>
            {mode === 'resetPassword'
              ? <Link className="landing-cta-primary auth-submit auth-action-continue" to="/forgot-password">{t('authActionNewResetLink')}</Link>
              : <Link className="landing-cta-primary auth-submit auth-action-continue" to={mode === 'verifyEmail' ? '/verify-email' : '/signin'}>
                  <MailCheck size={16} aria-hidden /><span>{mode === 'verifyEmail' ? t('authActionNewVerifyLink') : t('signIn')}</span>
                </Link>}
          </div>
        )}
      </div>
    </main>
  )
}

export default AuthAction
