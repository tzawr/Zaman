import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ArrowLeft, Check, User, Mail, ShieldCheck, Lock, Smartphone, KeyRound } from 'lucide-react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import {
  updateProfile,
  updatePassword,
  updatePhoneNumber,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { db, auth } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

const COUNTRY_CODES = [
  { code: '+1',   name: 'United States / Canada' },
  { code: '+7',   name: 'Russia / Kazakhstan' },
  { code: '+20',  name: 'Egypt' },
  { code: '+27',  name: 'South Africa' },
  { code: '+30',  name: 'Greece' },
  { code: '+31',  name: 'Netherlands' },
  { code: '+32',  name: 'Belgium' },
  { code: '+33',  name: 'France' },
  { code: '+34',  name: 'Spain' },
  { code: '+36',  name: 'Hungary' },
  { code: '+39',  name: 'Italy' },
  { code: '+40',  name: 'Romania' },
  { code: '+41',  name: 'Switzerland' },
  { code: '+43',  name: 'Austria' },
  { code: '+44',  name: 'United Kingdom' },
  { code: '+45',  name: 'Denmark' },
  { code: '+46',  name: 'Sweden' },
  { code: '+47',  name: 'Norway' },
  { code: '+48',  name: 'Poland' },
  { code: '+49',  name: 'Germany' },
  { code: '+52',  name: 'Mexico' },
  { code: '+55',  name: 'Brazil' },
  { code: '+61',  name: 'Australia' },
  { code: '+62',  name: 'Indonesia' },
  { code: '+63',  name: 'Philippines' },
  { code: '+64',  name: 'New Zealand' },
  { code: '+65',  name: 'Singapore' },
  { code: '+66',  name: 'Thailand' },
  { code: '+81',  name: 'Japan' },
  { code: '+82',  name: 'South Korea' },
  { code: '+86',  name: 'China' },
  { code: '+90',  name: 'Turkey' },
  { code: '+91',  name: 'India' },
  { code: '+92',  name: 'Pakistan' },
  { code: '+98',  name: 'Iran' },
  { code: '+212', name: 'Morocco' },
  { code: '+213', name: 'Algeria' },
  { code: '+216', name: 'Tunisia' },
  { code: '+234', name: 'Nigeria' },
  { code: '+249', name: 'Sudan' },
  { code: '+351', name: 'Portugal' },
  { code: '+353', name: 'Ireland' },
  { code: '+358', name: 'Finland' },
  { code: '+380', name: 'Ukraine' },
  { code: '+420', name: 'Czech Republic' },
  { code: '+421', name: 'Slovakia' },
  { code: '+966', name: 'Saudi Arabia' },
  { code: '+971', name: 'UAE' },
  { code: '+972', name: 'Israel' },
  { code: '+973', name: 'Bahrain' },
  { code: '+974', name: 'Qatar' },
  { code: '+994', name: 'Azerbaijan' },
  { code: '+995', name: 'Georgia' },
  { code: '+998', name: 'Uzbekistan' },
]

function Profile() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const { t, direction } = useI18n()

  const [userData, setUserData] = useState(null)
  const [displayName, setDisplayName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Email change
  const [showEmailChange, setShowEmailChange] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailReauthPassword, setEmailReauthPassword] = useState('')
  const [emailChangeLoading, setEmailChangeLoading] = useState(false)
  const [emailChangeMsg, setEmailChangeMsg] = useState('')

  // Phone verification
  const [countryCode, setCountryCode] = useState('+1')
  const [phoneStep, setPhoneStep] = useState('idle') // 'idle' | 'enter-phone' | 'enter-code'
  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneLoading, setPhoneLoading] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [phoneInfo, setPhoneInfo] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const recaptchaRef = useRef(null)

  // Password change
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false)
  const [passwordChangeMsg, setPasswordChangeMsg] = useState('')
  const [passwordResetSent, setPasswordResetSent] = useState(false)

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  useEffect(() => {
    if (!currentUser) return
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setUserData(d)
        setDisplayName(d.displayName || '')
        setBusinessName(d.businessName || '')
        setLoading(false)
      }
    })
    return () => unsub()
  }, [currentUser])

  // Tear down on unmount
  useEffect(() => {
    return () => {
      if (recaptchaRef.current) {
        recaptchaRef.current.clear()
        recaptchaRef.current = null
      }
    }
  }, [])

  // Firebase Phone Auth needs a RecaptchaVerifier on web. Keep it invisible and
  // attached to the send button so Google's own challenge appears only if needed.
  useEffect(() => {
    if (phoneStep !== 'enter-phone') {
      if (recaptchaRef.current) {
        recaptchaRef.current.clear()
        recaptchaRef.current = null
      }
      return
    }
    const timer = setTimeout(() => {
      if (recaptchaRef.current) {
        recaptchaRef.current.clear()
        recaptchaRef.current = null
      }
      try {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'phone-send-code-button', {
          size: 'invisible',
        })
        recaptchaRef.current.render().catch(() => {
          setPhoneError(t('recaptchaLoadFailed'))
        })
      } catch {
        setPhoneError(t('recaptchaLoadFailed'))
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [phoneStep, t])

  async function handleSave() {
    setSaving(true)
    try {
      await updateProfile(currentUser, { displayName: displayName.trim() })
      await setDoc(doc(db, 'users', currentUser.uid), {
        displayName: displayName.trim(),
        businessName: businessName.trim(),
        profileUpdatedAt: serverTimestamp(),
      }, { merge: true })
      toast.success(t('profileSaved'))
    } catch {
      toast.error(t('failedSaveProfile'))
    } finally {
      setSaving(false)
    }
  }

  const hasPasswordProvider = currentUser?.providerData?.some(p => p.providerId === 'password')
  const linkedPhone = currentUser?.phoneNumber

  async function handleEmailChange() {
    if (!newEmail.trim()) { setEmailChangeMsg(t('enterNewEmail')); return }
    setEmailChangeLoading(true)
    setEmailChangeMsg('')
    try {
      if (hasPasswordProvider && emailReauthPassword) {
        const cred = EmailAuthProvider.credential(currentUser.email, emailReauthPassword)
        await reauthenticateWithCredential(currentUser, cred)
      }
      await verifyBeforeUpdateEmail(currentUser, newEmail.trim())
      setNewEmail(''); setEmailReauthPassword(''); setShowEmailChange(false)
      toast.success(`${t('verificationEmailSentTo')} ${newEmail.trim()}`)
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setEmailChangeMsg(t('confirmCurrentPassword'))
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setEmailChangeMsg(t('authWrongPassword'))
      } else if (err.code === 'auth/email-already-in-use') {
        setEmailChangeMsg(t('emailAlreadyInUse'))
      } else {
        setEmailChangeMsg(err.message || t('failedUpdateEmail'))
      }
    } finally {
      setEmailChangeLoading(false)
    }
  }

  async function handleSendPhoneCode() {
    const localNumber = phoneNumber.trim().replace(/[\s\-()]/g, '')
    if (!localNumber) { setPhoneError(t('enterPhoneNumber')); return }
    if (!recaptchaRef.current) { setPhoneError(t('recaptchaNotReady')); return }
    const fullPhone = countryCode + localNumber
    setPhoneLoading(true)
    setPhoneError('')
    setPhoneInfo('')
    try {
      const provider = new PhoneAuthProvider(auth)
      const vid = await provider.verifyPhoneNumber(fullPhone, recaptchaRef.current)
      setVerificationId(vid)
      setPhoneStep('enter-code')
      setPhoneInfo(t('smsRequestSent'))
    } catch (err) {
      // Tear down and rebuild the verifier so the next attempt starts clean
      if (recaptchaRef.current) { recaptchaRef.current.clear(); recaptchaRef.current = null }
      try {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'phone-send-code-button', {
          size: 'invisible',
        })
        recaptchaRef.current.render().catch(() => {
          setPhoneError(t('recaptchaReloadFailed'))
        })
      } catch {
        setPhoneError(t('recaptchaReloadFailed'))
      }
      setPhoneError(formatPhoneAuthError(err, t))
    } finally {
      setPhoneLoading(false)
    }
  }

  function handleResendPhoneCode() {
    setPhoneStep('enter-phone')
    setPhoneCode('')
    setVerificationId('')
    setPhoneError('')
    setPhoneInfo(t('completeRecaptchaAgain'))
  }

  async function handleVerifyPhoneCode() {
    if (!phoneCode.trim()) { setPhoneError(t('enterSixDigitCode')); return }
    setPhoneLoading(true)
    setPhoneError('')
    try {
      const credential = PhoneAuthProvider.credential(verificationId, phoneCode.trim())
      if (linkedPhone) {
        await updatePhoneNumber(currentUser, credential)
      } else {
        await linkWithCredential(currentUser, credential)
      }
      setPhoneStep('idle'); setPhoneNumber(''); setPhoneCode(''); setVerificationId('')
      toast.success(t('phoneVerified'))
    } catch (err) {
      if (err.code === 'auth/invalid-verification-code') {
        setPhoneError(t('invalidCode'))
      } else if (err.code === 'auth/credential-already-in-use') {
        setPhoneError(t('phoneLinkedElsewhere'))
      } else {
        setPhoneError(formatPhoneAuthError(err, t))
      }
    } finally {
      setPhoneLoading(false)
    }
  }

  async function handlePasswordChange() {
    if (newPassword.length < 6) { setPasswordChangeMsg(t('passwordTooShort')); return }
    if (newPassword !== confirmPassword) { setPasswordChangeMsg(t('passwordsDoNotMatch')); return }
    if (!currentPassword) { setPasswordChangeMsg(t('enterCurrentPassword')); return }
    setPasswordChangeLoading(true)
    setPasswordChangeMsg('')
    try {
      const cred = EmailAuthProvider.credential(currentUser.email, currentPassword)
      await reauthenticateWithCredential(currentUser, cred)
      await updatePassword(currentUser, newPassword)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setShowPasswordChange(false)
      toast.success(t('passwordChanged'))
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPasswordChangeMsg(t('currentPasswordIncorrect'))
      } else {
        setPasswordChangeMsg(err.message || t('failedChangePassword'))
      }
    } finally {
      setPasswordChangeLoading(false)
    }
  }

  async function handlePasswordResetEmail() {
    try {
      await sendPasswordResetEmail(auth, currentUser.email)
      setPasswordResetSent(true)
      toast.success(t('resetEmailSent'))
    } catch {
      toast.error(t('failedSendResetEmail'))
    }
  }

  if (loading) {
    return (
      <main className="app-page">
        <div className="empty-state">
          <p>{t('loading')} <Loader2 size={16} className="spin" /></p>
        </div>
      </main>
    )
  }

  const initial = (displayName || '?')[0].toUpperCase()
  const isEmployee = userData?.accountType === 'employee'
  const isGoogleUser = currentUser?.providerData?.some(p => p.providerId === 'google.com')

  return (
    <main className="app-page">
      <button className="app-back-link" onClick={() => navigate(isEmployee ? '/my-schedule' : '/dashboard')}>
        <ArrowLeft size={14} />
        <span>{t('back')}</span>
      </button>

      <PageHero
        eyebrow={t('account')}
        title={t('profileTitle')}
        subtitle={t('profileSubtitle')}
      />

      <div className="profile-page-hero-row">
        <div className="profile-page-avatar">{initial}</div>
        <div className="profile-page-hero-info">
          <div className="profile-page-name">{displayName || t('noNameSet')}</div>
          <div className="profile-page-role">
            {isEmployee ? t('employee') : t('manager')}
            {userData?.userRole ? ` · ${userData.userRole}` : ''}
          </div>
        </div>
      </div>

      {/* Personal info */}
      <Section title={t('personalInfo')} subtitle={t('personalInfoSubtitle')} icon={User}>
        <div className="profile-edit-grid">
          <div className="auth-field">
            <label className="form-label">{t('displayName')}</label>
            <input
              type="text"
              className="input"
              placeholder={t('yourName')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          {!isEmployee && (
            <div className="auth-field">
              <label className="form-label">{t('businessName')}</label>
              <input
                type="text"
                className="input"
                placeholder={t('businessNamePlaceholder')}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            </div>
          )}
        </div>
        <button
          className="settings-button"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: 4 }}
        >
          {saving
            ? <><Loader2 size={14} className="spin" /> {t('saving')}</>
            : <><Check size={14} /> {t('saveChanges')}</>}
        </button>
      </Section>

      {/* Account info */}
      <Section title={t('accountInfo')} subtitle={t('accountInfoSubtitle')} icon={Mail}>
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('emailAddress')}</p>
            <p className="rule-description">{currentUser?.email}</p>
          </div>
          {isGoogleUser && (
            <span className="profile-google-badge">
              <ShieldCheck size={12} />
              Google
            </span>
          )}
        </div>
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('accountType')}</p>
            <p className="rule-description">{isEmployee ? t('employee') : t('manager')}</p>
          </div>
        </div>
      </Section>

      {/* Account security */}
      <Section
        title={t('accountSecurity')}
        subtitle={t('accountSecurityFullSubtitle')}
        icon={Lock}
      >
        {/* Email change */}
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('emailAddress')}</p>
            <p className="rule-description">{currentUser?.email}</p>
          </div>
          <button
            className="settings-button"
            onClick={() => { setShowEmailChange(v => !v); setEmailChangeMsg('') }}
          >
            {showEmailChange ? t('cancel') : t('change')}
          </button>
        </div>
        {showEmailChange && (
          <div className="security-form">
            <input
              type="email"
              className="input"
              placeholder={t('newEmailAddress')}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            {hasPasswordProvider && (
              <input
                type="password"
                className="input"
                placeholder={t('currentPasswordConfirm')}
                value={emailReauthPassword}
                onChange={(e) => setEmailReauthPassword(e.target.value)}
              />
            )}
            {emailChangeMsg && <div className="auth-error">{emailChangeMsg}</div>}
            <button
              className="landing-cta-primary auth-submit"
              onClick={handleEmailChange}
              disabled={emailChangeLoading}
              style={{ justifyContent: 'center' }}
            >
              <span>{emailChangeLoading ? t('sending') : t('sendVerification')}</span>
            </button>
          </div>
        )}

        {/* Phone number */}
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('phoneNumber')}</p>
            <p className="rule-description">{linkedPhone || t('noPhoneAdded')}</p>
          </div>
          {phoneStep === 'idle' && (
            <button
              className="settings-button"
              onClick={() => { setPhoneStep('enter-phone'); setPhoneError('') }}
            >
              {linkedPhone ? t('change') : t('add')}
            </button>
          )}
        </div>
        {phoneStep === 'enter-phone' && (
          <div className="security-form">
            <div className="phone-input-row">
              <select
                className="input phone-country-select"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
              >
                {COUNTRY_CODES.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                className="input"
                placeholder="555 000 1234"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
              {t('fullNumber')}: {countryCode}{phoneNumber.trim().replace(/[\s\-()]/g, '') || '...'}
            </p>
            {phoneInfo && <div className="auth-success">{phoneInfo}</div>}
            {phoneError && <div className="auth-error">{phoneError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-button" onClick={() => { setPhoneStep('idle'); setPhoneError(''); setPhoneNumber('') }}>
                {t('cancel')}
              </button>
              <button
                id="phone-send-code-button"
                className="landing-cta-primary auth-submit"
                onClick={handleSendPhoneCode}
                disabled={phoneLoading}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <Smartphone size={14} />
                <span>{phoneLoading ? t('sending') : t('sendCode')}</span>
              </button>
            </div>
          </div>
        )}
        {phoneStep === 'enter-code' && (
          <div className="security-form">
            <p style={{ fontSize: 13, opacity: 0.65, margin: 0 }}>
              {t('codeSentTo')} {countryCode}{phoneNumber.trim().replace(/[\s\-()]/g, '')}
            </p>
            {phoneInfo && <div className="auth-success">{phoneInfo}</div>}
            <input
              type="text"
              className="input"
              placeholder="000000"
              maxLength={6}
              value={phoneCode}
              onChange={(e) => setPhoneCode(e.target.value)}
              autoFocus
            />
            {phoneError && <div className="auth-error">{phoneError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-button" onClick={() => { setPhoneStep('idle'); setPhoneError(''); setPhoneInfo(''); setPhoneCode('') }}>
                {t('cancel')}
              </button>
              <button className="settings-button" onClick={handleResendPhoneCode} disabled={phoneLoading}>
                {t('resendCode')}
              </button>
              <button
                className="landing-cta-primary auth-submit"
                onClick={handleVerifyPhoneCode}
                disabled={phoneLoading}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <span>{phoneLoading ? t('verifying') : t('verifyCode')}</span>
              </button>
            </div>
          </div>
        )}
        {/* Password change */}
        {hasPasswordProvider && (
          <>
            <div className="rule-card">
              <div className="rule-info">
                <p className="rule-title">{t('password')}</p>
                <p className="rule-description">{t('passwordSecurityDesc')}</p>
              </div>
              <button
                className="settings-button"
                onClick={() => { setShowPasswordChange(v => !v); setPasswordChangeMsg('') }}
              >
                {showPasswordChange ? t('cancel') : t('change')}
              </button>
            </div>
            {showPasswordChange && (
              <div className="security-form">
                <input
                  type="password"
                  className="input"
                  placeholder={t('currentPassword')}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <input
                  type="password"
                  className="input"
                  placeholder={t('newPasswordPlaceholder')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  className="input"
                  placeholder={t('confirmNewPassword')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {passwordChangeMsg && (
                  <div className="auth-error">{passwordChangeMsg}</div>
                )}
                <button
                  className="landing-cta-primary auth-submit"
                  onClick={handlePasswordChange}
                  disabled={passwordChangeLoading}
                  style={{ justifyContent: 'center' }}
                >
                  <KeyRound size={14} />
                  <span>{passwordChangeLoading ? t('changing') : t('changePassword')}</span>
                </button>
                <button
                  className="link-button"
                  style={{ fontSize: 12, marginTop: 2, textAlign: direction === 'rtl' ? 'right' : 'left' }}
                  onClick={handlePasswordResetEmail}
                  disabled={passwordResetSent}
                >
                  {passwordResetSent ? t('resetEmailSent') : t('forgotPasswordReset')}
                </button>
              </div>
            )}
          </>
        )}
      </Section>
    </main>
  )
}

function formatPhoneAuthError(err, t) {
  const code = err?.code
  const map = {
    'auth/invalid-phone-number': t('phoneInvalid'),
    'auth/missing-phone-number': t('phoneMissing'),
    'auth/captcha-check-failed': t('captchaFailed'),
    'auth/missing-app-credential': t('captchaMissingCredential'),
    'auth/too-many-requests': t('smsTooManyAttempts'),
    'auth/quota-exceeded': t('smsQuotaExceeded'),
    'auth/operation-not-allowed': t('phoneAuthDisabled'),
    'auth/unauthorized-domain': t('unauthorizedDomain'),
    'auth/internal-error': t('firebaseSmsFailed'),
  }
  return map[code] || err?.message || t('smsFailed')
}

export default Profile
