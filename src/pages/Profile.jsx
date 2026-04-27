import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ArrowLeft, Check, User, Mail, ShieldCheck, Lock, Smartphone, KeyRound } from 'lucide-react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import {
  updateProfile,
  updatePassword,
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

  // Initialize reCAPTCHA as soon as the phone form opens so it's warm by the time
  // the user clicks "Send code". A 150ms timeout lets React finish painting the DOM
  // before we attach the widget (avoids the reCAPTCHA timeout on real numbers).
  useEffect(() => {
    if (phoneStep !== 'enter-phone') {
      if (recaptchaRef.current) {
        recaptchaRef.current.clear()
        recaptchaRef.current = null
      }
      return
    }
    const t = setTimeout(() => {
      if (recaptchaRef.current) {
        recaptchaRef.current.clear()
        recaptchaRef.current = null
      }
      try {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
          'data-s': 'v2',
        })
        recaptchaRef.current.render().catch(() => {})
      } catch {}
    }, 150)
    return () => clearTimeout(t)
  }, [phoneStep])

  async function handleSave() {
    setSaving(true)
    try {
      await updateProfile(currentUser, { displayName: displayName.trim() })
      await setDoc(doc(db, 'users', currentUser.uid), {
        displayName: displayName.trim(),
        businessName: businessName.trim(),
        profileUpdatedAt: serverTimestamp(),
      }, { merge: true })
      toast.success('Profile saved!')
    } catch {
      toast.error('Failed to save profile.')
    } finally {
      setSaving(false)
    }
  }

  const hasPasswordProvider = currentUser?.providerData?.some(p => p.providerId === 'password')
  const linkedPhone = currentUser?.phoneNumber

  async function handleEmailChange() {
    if (!newEmail.trim()) { setEmailChangeMsg('Enter a new email address.'); return }
    setEmailChangeLoading(true)
    setEmailChangeMsg('')
    try {
      if (hasPasswordProvider && emailReauthPassword) {
        const cred = EmailAuthProvider.credential(currentUser.email, emailReauthPassword)
        await reauthenticateWithCredential(currentUser, cred)
      }
      await verifyBeforeUpdateEmail(currentUser, newEmail.trim())
      setNewEmail(''); setEmailReauthPassword(''); setShowEmailChange(false)
      toast.success('Verification email sent to ' + newEmail.trim())
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setEmailChangeMsg('Enter your current password to confirm.')
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setEmailChangeMsg('Incorrect password.')
      } else if (err.code === 'auth/email-already-in-use') {
        setEmailChangeMsg('That email is already in use.')
      } else {
        setEmailChangeMsg(err.message || 'Failed to update email.')
      }
    } finally {
      setEmailChangeLoading(false)
    }
  }

  async function handleSendPhoneCode() {
    const localNumber = phoneNumber.trim().replace(/[\s\-()]/g, '')
    if (!localNumber) { setPhoneError('Enter your phone number.'); return }
    if (!recaptchaRef.current) { setPhoneError('reCAPTCHA not ready yet — wait a moment and try again.'); return }
    const fullPhone = countryCode + localNumber
    setPhoneLoading(true)
    setPhoneError('')
    try {
      const provider = new PhoneAuthProvider(auth)
      const vid = await provider.verifyPhoneNumber(fullPhone, recaptchaRef.current)
      setVerificationId(vid)
      setPhoneStep('enter-code')
    } catch (err) {
      // Tear down and rebuild the verifier so the next attempt starts clean
      if (recaptchaRef.current) { recaptchaRef.current.clear(); recaptchaRef.current = null }
      try {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible', 'data-s': 'v2' })
        recaptchaRef.current.render().catch(() => {})
      } catch {}
      setPhoneError(err.message || 'Failed to send code. Make sure the number is correct.')
    } finally {
      setPhoneLoading(false)
    }
  }

  async function handleVerifyPhoneCode() {
    if (!phoneCode.trim()) { setPhoneError('Enter the 6-digit code.'); return }
    setPhoneLoading(true)
    setPhoneError('')
    try {
      const credential = PhoneAuthProvider.credential(verificationId, phoneCode.trim())
      await linkWithCredential(currentUser, credential)
      setPhoneStep('idle'); setPhoneNumber(''); setPhoneCode(''); setVerificationId('')
      toast.success('Phone number verified!')
    } catch (err) {
      if (err.code === 'auth/invalid-verification-code') {
        setPhoneError('Invalid code. Check and try again.')
      } else if (err.code === 'auth/credential-already-in-use') {
        setPhoneError('That phone number is linked to another account.')
      } else {
        setPhoneError(err.message || 'Verification failed.')
      }
    } finally {
      setPhoneLoading(false)
    }
  }

  async function handlePasswordChange() {
    if (newPassword.length < 6) { setPasswordChangeMsg('New password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword) { setPasswordChangeMsg('Passwords do not match.'); return }
    if (!currentPassword) { setPasswordChangeMsg('Enter your current password.'); return }
    setPasswordChangeLoading(true)
    setPasswordChangeMsg('')
    try {
      const cred = EmailAuthProvider.credential(currentUser.email, currentPassword)
      await reauthenticateWithCredential(currentUser, cred)
      await updatePassword(currentUser, newPassword)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setShowPasswordChange(false)
      toast.success('Password changed!')
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPasswordChangeMsg('Current password is incorrect.')
      } else {
        setPasswordChangeMsg(err.message || 'Failed to change password.')
      }
    } finally {
      setPasswordChangeLoading(false)
    }
  }

  async function handlePasswordResetEmail() {
    try {
      await sendPasswordResetEmail(auth, currentUser.email)
      setPasswordResetSent(true)
      toast.success('Reset email sent!')
    } catch {
      toast.error('Failed to send reset email.')
    }
  }

  if (loading) {
    return (
      <main className="app-page">
        <div className="empty-state">
          <p>Loading... <Loader2 size={16} className="spin" /></p>
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
        <span>Back</span>
      </button>

      <PageHero
        eyebrow="Account"
        title="Your profile"
        subtitle="Manage your personal details and account security."
      />

      <div className="profile-page-hero-row">
        <div className="profile-page-avatar">{initial}</div>
        <div className="profile-page-hero-info">
          <div className="profile-page-name">{displayName || 'No name set'}</div>
          <div className="profile-page-role">
            {isEmployee ? 'Employee' : 'Manager'}
            {userData?.userRole ? ` · ${userData.userRole}` : ''}
          </div>
        </div>
      </div>

      {/* Personal info */}
      <Section title="Personal info" subtitle="Your name as shown across Zaman." icon={User}>
        <div className="profile-edit-grid">
          <div className="auth-field">
            <label className="form-label">Display name</label>
            <input
              type="text"
              className="input"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          {!isEmployee && (
            <div className="auth-field">
              <label className="form-label">Business name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Blue Door Café"
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
            ? <><Loader2 size={14} className="spin" /> Saving...</>
            : <><Check size={14} /> Save changes</>}
        </button>
      </Section>

      {/* Account info */}
      <Section title="Account info" subtitle="Your sign-in email and account type." icon={Mail}>
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">Email address</p>
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
            <p className="rule-title">Account type</p>
            <p className="rule-description">{isEmployee ? 'Employee' : 'Manager'}</p>
          </div>
        </div>
      </Section>

      {/* Account security */}
      <Section
        title="Account security"
        subtitle="Change your email, phone, and password."
        icon={Lock}
      >
        {/* Email change */}
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">Email address</p>
            <p className="rule-description">{currentUser?.email}</p>
          </div>
          <button
            className="settings-button"
            onClick={() => { setShowEmailChange(v => !v); setEmailChangeMsg('') }}
          >
            {showEmailChange ? 'Cancel' : 'Change'}
          </button>
        </div>
        {showEmailChange && (
          <div className="security-form">
            <input
              type="email"
              className="input"
              placeholder="New email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            {hasPasswordProvider && (
              <input
                type="password"
                className="input"
                placeholder="Current password (to confirm)"
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
              <span>{emailChangeLoading ? 'Sending...' : 'Send verification'}</span>
            </button>
          </div>
        )}

        {/* Phone number */}
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">Phone number</p>
            <p className="rule-description">{linkedPhone || 'No phone number added'}</p>
          </div>
          {phoneStep === 'idle' && (
            <button
              className="settings-button"
              onClick={() => { setPhoneStep('enter-phone'); setPhoneError('') }}
            >
              {linkedPhone ? 'Change' : 'Add'}
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
              Full number: {countryCode}{phoneNumber.trim().replace(/[\s\-()]/g, '') || '…'}
            </p>
            {phoneError && <div className="auth-error">{phoneError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-button" onClick={() => { setPhoneStep('idle'); setPhoneError(''); setPhoneNumber('') }}>
                Cancel
              </button>
              <button
                className="landing-cta-primary auth-submit"
                onClick={handleSendPhoneCode}
                disabled={phoneLoading}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <Smartphone size={14} />
                <span>{phoneLoading ? 'Sending...' : 'Send code'}</span>
              </button>
            </div>
          </div>
        )}
        {phoneStep === 'enter-code' && (
          <div className="security-form">
            <p style={{ fontSize: 13, opacity: 0.65, margin: 0 }}>
              Enter the 6-digit code sent to {countryCode}{phoneNumber.trim().replace(/[\s\-()]/g, '')}
            </p>
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
              <button className="settings-button" onClick={() => { setPhoneStep('idle'); setPhoneError(''); setPhoneCode('') }}>
                Cancel
              </button>
              <button
                className="landing-cta-primary auth-submit"
                onClick={handleVerifyPhoneCode}
                disabled={phoneLoading}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <span>{phoneLoading ? 'Verifying...' : 'Verify code'}</span>
              </button>
            </div>
          </div>
        )}
        <div id="recaptcha-container" />

        {/* Password change */}
        {hasPasswordProvider && (
          <>
            <div className="rule-card">
              <div className="rule-info">
                <p className="rule-title">Password</p>
                <p className="rule-description">Change your account password.</p>
              </div>
              <button
                className="settings-button"
                onClick={() => { setShowPasswordChange(v => !v); setPasswordChangeMsg('') }}
              >
                {showPasswordChange ? 'Cancel' : 'Change'}
              </button>
            </div>
            {showPasswordChange && (
              <div className="security-form">
                <input
                  type="password"
                  className="input"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <input
                  type="password"
                  className="input"
                  placeholder="New password (min. 6 characters)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  className="input"
                  placeholder="Confirm new password"
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
                  <span>{passwordChangeLoading ? 'Changing...' : 'Change password'}</span>
                </button>
                <button
                  className="link-button"
                  style={{ fontSize: 12, marginTop: 2, textAlign: 'left' }}
                  onClick={handlePasswordResetEmail}
                  disabled={passwordResetSent}
                >
                  {passwordResetSent ? 'Reset email sent!' : 'Forgot your current password? Send a reset link instead'}
                </button>
              </div>
            )}
          </>
        )}
      </Section>
    </main>
  )
}

export default Profile
