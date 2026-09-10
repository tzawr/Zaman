import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ArrowLeft, Check, X, ArrowRight, Pencil, Trash2, Plus, Clock, Shield, Target, Users, Eye, KeyRound, Lock, AlignLeft, Mic, MicOff, AlertTriangle } from 'lucide-react'
import { doc, onSnapshot, setDoc, serverTimestamp, collection, query, where, getDocs, writeBatch } from 'firebase/firestore'
import {
  updatePassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { googleProvider } from '../firebase'
import { db, auth } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import TimeSelect from '../components/TimeSelect'
import { useSpeechInput } from '../utils/useSpeechInput'
import { useI18n } from '../i18n'

const DAYS = [
  { key: 'monday', labelKey: 'dayMonday' },
  { key: 'tuesday', labelKey: 'dayTuesday' },
  { key: 'wednesday', labelKey: 'dayWednesday' },
  { key: 'thursday', labelKey: 'dayThursday' },
  { key: 'friday', labelKey: 'dayFriday' },
  { key: 'saturday', labelKey: 'daySaturday' },
  { key: 'sunday', labelKey: 'daySunday' }
]

const DEFAULT_HOURS = DAYS.reduce((acc, d) => {
  acc[d.key] = { open: true, start: '07:00', end: '22:00' }
  return acc
}, {})

const DEFAULT_COVERAGE = DAYS.reduce((acc, d) => {
  acc[d.key] = { minPeople: 2 }
  return acc
}, {})

// '00:00' as a closing time means midnight, the end of the day.
function toMinutes(value, isClosing = true) {
  if (typeof value !== 'string') return 0
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h)) return 0
  const mins = h * 60 + (m || 0)
  return isClosing && mins === 0 ? 24 * 60 : mins
}

function Settings() {
  const navigate = useNavigate()
  const { currentUser, logOut } = useAuth()
  const toast = useToast()
  const { t, tf } = useI18n()

  const [operatingHours, setOperatingHours] = useState(DEFAULT_HOURS)
  const [coverage, setCoverage] = useState(DEFAULT_COVERAGE)
  const [preventClopening, setPreventClopening] = useState(true)
  const [minHoursBetweenShifts, setMinHoursBetweenShifts] = useState(10)
  const [allowEmployeeFullView, setAllowEmployeeFullView] = useState(false)
  const [allowEmployeeAvailabilityUpdates, setAllowEmployeeAvailabilityUpdates] = useState(false)
  const [roles, setRoles] = useState([])
  const [coverageRules, setCoverageRules] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newRoleName, setNewRoleName] = useState('')
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleName, setEditingRoleName] = useState('')

  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordChangeMsg, setPasswordChangeMsg] = useState('')
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false)
  const [passwordResetSent, setPasswordResetSent] = useState(false)
  const coverageSpeech = useSpeechInput((text) => {
    setCoverageRules(prev => prev ? `${prev.trim()}\n${text}` : text)
  })

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  useEffect(() => {
    if (!currentUser) return
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        if (!d.onboarded) {
          navigate('/onboarding')
          return
        }
        if (d.operatingHours) setOperatingHours(d.operatingHours)
        if (d.coverage) setCoverage(d.coverage)
        if (d.preventClopening !== undefined) setPreventClopening(d.preventClopening)
        if (d.minHoursBetweenShifts) setMinHoursBetweenShifts(d.minHoursBetweenShifts)
        if (d.allowEmployeeFullView !== undefined) setAllowEmployeeFullView(d.allowEmployeeFullView)
        if (d.allowEmployeeAvailabilityUpdates !== undefined) setAllowEmployeeAvailabilityUpdates(d.allowEmployeeAvailabilityUpdates)
        if (d.roles) setRoles(d.roles)
        if (d.coverageRules !== undefined) setCoverageRules(d.coverageRules)
        setLoading(false)
      }
    })
    return () => unsub()
  }, [currentUser, navigate])

  async function saveToFirebase(updates) {
    try {
      setSaving(true)
      await setDoc(
        doc(db, 'users', currentUser.uid),
        { ...updates, settingsUpdatedAt: serverTimestamp() },
        { merge: true }
      )
    } catch {
      toast.error(t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(k) {
    const next = { ...operatingHours, [k]: { ...operatingHours[k], open: !operatingHours[k].open } }
    setOperatingHours(next); saveToFirebase({ operatingHours: next })
  }
  function updateHourTime(k, field, v) {
    const next = { ...operatingHours, [k]: { ...operatingHours[k], [field]: v } }
    setOperatingHours(next); saveToFirebase({ operatingHours: next })
    // Closing at or before opening means the day trades past midnight. That is
    // supported, but it is also an easy mis-tap, so confirm what was set.
    const day = next[k]
    if (day.open && toMinutes(day.end) <= toMinutes(day.start, false)) {
      toast.info(tf('toastOvernightHours', { start: day.start, end: day.end }))
    }
  }
  function updateCoverage(k, v) {
    const n = parseInt(v) || 0
    const next = { ...coverage, [k]: { minPeople: n } }
    setCoverage(next); saveToFirebase({ coverage: next })
  }
  function toggleClopeningPrevention() {
    const v = !preventClopening; setPreventClopening(v); saveToFirebase({ preventClopening: v })
  }
  async function propagatePermissionsToEmployees(updates) {
    try {
      const q = query(
        collection(db, 'users'),
        where('managerId', '==', currentUser.uid),
        where('accountType', '==', 'employee')
      )
      const snap = await getDocs(q)
      if (snap.empty) return
      const batch = writeBatch(db)
      snap.docs.forEach(d => batch.update(d.ref, updates))
      await batch.commit()
    } catch {
      // Requires Firestore rule: allow write if resource.data.managerId == request.auth.uid
    }
  }
  function toggleAllowEmployeeFullView() {
    const v = !allowEmployeeFullView
    setAllowEmployeeFullView(v)
    saveToFirebase({ allowEmployeeFullView: v })
    propagatePermissionsToEmployees({ allowEmployeeFullView: v })
  }
  function toggleEmployeeAvailabilityUpdates() {
    const v = !allowEmployeeAvailabilityUpdates
    setAllowEmployeeAvailabilityUpdates(v)
    saveToFirebase({ allowEmployeeAvailabilityUpdates: v })
    propagatePermissionsToEmployees({ allowEmployeeAvailabilityUpdates: v })
  }
  function updateMinHours(v) {
    const n = parseInt(v) || 8; setMinHoursBetweenShifts(n); saveToFirebase({ minHoursBetweenShifts: n })
  }

  // Roles
  async function addRole() {
    const roleName = newRoleName.trim()
    if (!roleName) { toast.info(t('toastEnterRoleName')); return }
    if (roles.some(r => r.name.toLowerCase() === roleName.toLowerCase())) {
      toast.info(t('toastRoleExists')); return
    }
    const next = [...roles, { id: Date.now().toString(), name: roleName }]
    await saveToFirebase({ roles: next })
    setNewRoleName('')
    toast.success(`${t('addedPrefix')} "${roleName}"`)
  }
  function startEditRole(r) { setEditingRoleId(r.id); setEditingRoleName(r.name) }
  async function saveEditRole() {
    const roleName = editingRoleName.trim()
    if (!roleName) { toast.info(t('toastRoleEmpty')); return }
    if (roles.some(r => r.id !== editingRoleId && r.name.toLowerCase() === roleName.toLowerCase())) {
      toast.info(t('toastRoleDuplicate')); return
    }
    const next = roles.map(r => r.id === editingRoleId ? { ...r, name: roleName } : r)
    await saveToFirebase({ roles: next })
    setEditingRoleId(null); setEditingRoleName('')
    toast.success(t('toastRoleUpdated'))
  }
  function cancelEditRole() { setEditingRoleId(null); setEditingRoleName('') }
  async function deleteRole(id, name) {
    if (!window.confirm(`${t('confirmDeleteRoleBefore')} "${name}" ${t('confirmDeleteRoleAfter')}`)) return
    const next = roles.filter(r => r.id !== id)
    await saveToFirebase({ roles: next })
    toast.success(`${t('deletedPrefix')} "${name}"`)
  }

  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState('')

  const hasPasswordProvider = currentUser?.providerData?.some(p => p.providerId === 'password')

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

  // The Terms promised this and the app did not have it. Deleting is done by
  // the server, which owns the whole erase: a browser loop that gets halfway
  // through a hundred documents and drops its connection leaves an account
  // half-erased with nothing recording how far it got.
  async function handleDeleteAccount() {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteMsg(t('deleteAccountTypeMismatch'))
      return
    }
    setDeleteLoading(true)
    setDeleteMsg('')
    try {
      // Prove it is really them, right now. The endpoint checks the token's
      // auth_time and refuses anything older than five minutes, so a session
      // left open for a week cannot erase an account on its own.
      if (hasPasswordProvider) {
        if (!deletePassword) { setDeleteMsg(t('enterCurrentPassword')); setDeleteLoading(false); return }
        const cred = EmailAuthProvider.credential(currentUser.email, deletePassword)
        await reauthenticateWithCredential(currentUser, cred)
      } else {
        await reauthenticateWithPopup(currentUser, googleProvider)
      }

      const token = await currentUser.getIdToken(true)
      const resp = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        setDeleteMsg(body.message || t('deleteAccountFailed'))
        setDeleteLoading(false)
        return
      }

      toast.success(t('deleteAccountDone'))
      // The auth user is gone, so the session is already void; this clears the
      // local one and drops them on the landing page.
      await logOut().catch(() => {})
      navigate('/', { replace: true })
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setDeleteMsg(t('deleteAccountWrongPassword'))
      } else if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        setDeleteMsg(t('deleteAccountReauthFailed'))
      } else {
        setDeleteMsg(t('deleteAccountFailed'))
      }
      setDeleteLoading(false)
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

  return (
    <main className="app-page">
      <button className="app-back-link" onClick={() => navigate('/dashboard')}>
        <ArrowLeft size={14} />
        <span>{t('backToDashboard')}</span>
      </button>

      <PageHero
        eyebrow={t('workspaceEyebrow')}
        title={t('workspace')}
        subtitle={t('workspaceSubtitle')}
      >
        {saving && (
          <span className="saving-pill">
            <Clock size={12} />
            {t('saving')}
          </span>
        )}
      </PageHero>

      <Section
        title={t('rolesTitle')}
        subtitle={t('rolesSubtitle')}
        icon={Users}
      >
        <div className="roles-list">
          {roles.map(r => (
            <div key={r.id} className="role-item">
              {editingRoleId === r.id ? (
                <>
                  <input
                    type="text"
                    className="input role-edit-input"
                    aria-label={t('a11yRoleName')}
                    value={editingRoleName}
                    onChange={(e) => setEditingRoleName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEditRole()
                      if (e.key === 'Escape') cancelEditRole()
                    }}
                    autoFocus
                  />
                  <div className="role-actions">
                    <button className="role-save-btn" onClick={saveEditRole}>
                      <Check size={16} />
                    </button>
                    <button className="role-cancel-btn" onClick={cancelEditRole}>
                      <X size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="role-name">{r.name}</div>
                  <div className="role-actions">
                    <button className="role-edit-btn" onClick={() => startEditRole(r)} aria-label={t('edit')}>
                      <Pencil size={14} />
                    </button>
                    <button className="role-delete-btn" onClick={() => deleteRole(r.id, r.name)} aria-label={t('delete')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {roles.length === 0 && (
            <p className="role-empty">{t('noRolesYet')}</p>
          )}
        </div>
        <div className="role-add-row">
          <input
            type="text"
            className="input"
            placeholder={t('rolePlaceholder')}
            aria-label={t('rolePlaceholder')}
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRole()}
          />
          <button className="add-button" onClick={addRole}>
            <Plus size={16} />
            <span>{t('addRole')}</span>
          </button>
        </div>
      </Section>

      <Section
        title={t('operatingHours')}
        subtitle={t('operatingHoursSubtitle')}
        icon={Clock}
      >
        <div className="day-list">
          {DAYS.map(day => {
            const d = operatingHours[day.key]
            return (
              <div key={day.key} className={`day-row ${d.open ? 'available' : 'unavailable'}`}>
                <button className="day-toggle" onClick={() => toggleDay(day.key)}>
                  <span className="day-name">{t(day.labelKey)}</span>
                  <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {d.open ? <><Check size={16} /><span>{t('open')}</span></> : <><X size={16} /><span>{t('closed')}</span></>}
                  </span>
                </button>
                {d.open && (
                  <div className="time-inputs">
                    <TimeSelect
                      value={d.start}
                      onChange={(v) => updateHourTime(day.key, 'start', v)}
                    />
                    <span className="time-arrow"><ArrowRight size={16} /></span>
                    <TimeSelect
                      value={d.end}
                      onChange={(v) => updateHourTime(day.key, 'end', v)}
                    />
                    {toMinutes(d.end) <= toMinutes(d.start, false) && (
                      <span className="overnight-badge">{t('overnightBadge')}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section
        title={t('coverageMinimums')}
        subtitle={t('coverageMinimumsSubtitle')}
        icon={Target}
      >
        <div className="day-list">
          {DAYS.map(day => {
            const d = operatingHours[day.key]
            const c = coverage[day.key]?.minPeople ?? 2
            return (
              <div key={day.key} className={`day-row ${d.open ? 'available' : 'unavailable'}`}>
                <div className="day-toggle">
                  <span className="day-name">{t(day.labelKey)}</span>
                  <span className="day-status">{d.open ? t('open') : t('closed')}</span>
                </div>
                {d.open && (
                  <div className="coverage-input-wrapper">
                    <input
                      type="number"
                      min="1"
                      max="20"
                      className="time-input coverage-input"
                      aria-label={`${t('a11yPeopleNeeded')} — ${t(day.labelKey)}`}
                      value={c}
                      onChange={(e) => updateCoverage(day.key, e.target.value)}
                    />
                    <span className="coverage-label">{c === 1 ? t('person') : t('people')} {t('min')}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section
        title={t('coverageRules')}
        subtitle={t('coverageRulesSubtitle')}
        icon={AlignLeft}
      >
        <div className="instruction-editor coverage-rule-editor">
          <div className="instruction-toolbar">
            <div className="instruction-toolbar-copy">
              <Mic size={15} />
              <span>{t('speakCoverageRules')}</span>
            </div>
            {coverageSpeech.supported ? (
              <button
                type="button"
                className={`voice-button voice-button-premium ${coverageSpeech.listening ? 'listening' : ''}`}
                onClick={coverageSpeech.toggleListening}
                title={coverageSpeech.listening ? t('stopDictation') : t('dictateCoverageRules')}
              >
                <span className="voice-dot" aria-hidden />
                {coverageSpeech.listening ? <MicOff size={16} /> : <Mic size={16} />}
                <span>{coverageSpeech.listening ? t('listening') : t('startDictation')}</span>
              </button>
            ) : (
              <span className="voice-unavailable">{t('voiceUnavailable')}</span>
            )}
          </div>
          <textarea
            className="input ai-instr-textarea"
            rows={5}
            placeholder={t('coverageRulesPlaceholder')}
            aria-label={t('coverageRulesPlaceholder')}
            value={coverageRules}
            onChange={(e) => setCoverageRules(e.target.value)}
            onBlur={() => saveToFirebase({ coverageRules })}
            style={{ resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '6px 0 0' }}>
          {t('autoSaveOnBlur')}
        </p>
      </Section>

      <Section
        title={t('schedulingRules')}
        subtitle={t('schedulingRulesSubtitle')}
        icon={Shield}
      >
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('preventClopening')}</p>
            <p className="rule-description">{t('preventClopeningDesc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={preventClopening}
              onChange={toggleClopeningPrevention}
            />
            <span className="slider"></span>
          </label>
        </div>
        {preventClopening && (
          <div className="rule-card">
            <div className="rule-info">
              <p className="rule-title">{t('minimumHoursBetweenShifts')}</p>
              <p className="rule-description">{t('minimumHoursBetweenShiftsDesc')}</p>
            </div>
            <div className="coverage-input-wrapper">
              <input
                type="number"
                min="6"
                max="24"
                className="time-input coverage-input"
                aria-label={t('a11yMinHoursBetween')}
                value={minHoursBetweenShifts}
                onChange={(e) => updateMinHours(e.target.value)}
              />
              <span className="coverage-label">{t('hours')}</span>
            </div>
          </div>
        )}
      </Section>

      <Section
        title={t('teamAccess')}
        subtitle={t('teamAccessSubtitle')}
        icon={Eye}
      >
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('allowFullScheduleTitle')}</p>
            <p className="rule-description">{t('allowFullScheduleDesc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={allowEmployeeFullView}
              onChange={toggleAllowEmployeeFullView}
            />
            <span className="slider"></span>
          </label>
        </div>
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('allowAvailabilityTitle')}</p>
            <p className="rule-description">{t('allowAvailabilityDesc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={allowEmployeeAvailabilityUpdates}
              onChange={toggleEmployeeAvailabilityUpdates}
            />
            <span className="slider"></span>
          </label>
        </div>
      </Section>

      {hasPasswordProvider && (
        <Section
          title={t('accountSecurity')}
          subtitle={t('accountSecuritySubtitle')}
          icon={Lock}
        >
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
                aria-label={t('currentPassword')}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
              <input
                type="password"
                className="input"
                placeholder={t('newPasswordPlaceholder')}
                aria-label={t('newPasswordPlaceholder')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <input
                type="password"
                className="input"
                placeholder={t('confirmNewPassword')}
                aria-label={t('confirmNewPassword')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              {passwordChangeMsg && <div className="auth-error">{passwordChangeMsg}</div>}
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
                style={{ fontSize: 12, marginTop: 2, textAlign: 'left' }}
                onClick={handlePasswordResetEmail}
                disabled={passwordResetSent}
              >
                {passwordResetSent ? t('resetEmailSent') : t('forgotPasswordReset')}
              </button>
            </div>
          )}
        </Section>
      )}

      <Section
        title={t('deleteAccountTitle')}
        subtitle={t('deleteAccountSubtitle')}
        icon={AlertTriangle}
        delay={0.35}
      >
        <div className="danger-zone">
          <p>{t('deleteAccountIntro')}</p>
          <ul>
            <li>{t('deleteAccountItem1')}</li>
            <li>{t('deleteAccountItem2')}</li>
            <li>{t('deleteAccountItem3')}</li>
            <li>{t('deleteAccountItem4')}</li>
          </ul>
          <p className="danger-zone-note">{t('deleteAccountEmployeeNote')}</p>
          <p className="danger-zone-warning">{t('deleteAccountWarning')}</p>

          {!showDeleteAccount ? (
            <button
              type="button"
              className="danger-button"
              onClick={() => setShowDeleteAccount(true)}
            >
              <Trash2 size={14} />
              <span>{t('deleteAccountButton')}</span>
            </button>
          ) : (
            <div className="danger-zone-confirm">
              <p className="danger-zone-confirm-title">{t('deleteAccountConfirmTitle')}</p>

              {hasPasswordProvider ? (
                <>
                  <label htmlFor="settings-delete-password" className="form-label">
                    {t('deleteAccountConfirmPassword')}
                  </label>
                  <input
                    id="settings-delete-password"
                    type="password"
                    className="input"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </>
              ) : (
                <p className="danger-zone-note">{t('deleteAccountConfirmGoogle')}</p>
              )}

              {/* A typed word, so the last click cannot be a mis-tap. */}
              <label htmlFor="settings-delete-confirm" className="form-label">
                {t('deleteAccountTypeToConfirm')}
              </label>
              <input
                id="settings-delete-confirm"
                type="text"
                className="input"
                placeholder={t('deleteAccountTypeWord')}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoComplete="off"
              />

              {deleteMsg && <div className="auth-error">{deleteMsg}</div>}

              <div className="danger-zone-actions">
                <button
                  type="button"
                  className="danger-button"
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                >
                  {deleteLoading ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                  <span>{deleteLoading ? t('deleteAccountDeleting') : t('deleteAccountConfirmButton')}</span>
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setShowDeleteAccount(false)
                    setDeletePassword('')
                    setDeleteConfirmText('')
                    setDeleteMsg('')
                  }}
                  disabled={deleteLoading}
                >
                  {t('deleteAccountCancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </Section>

    </main>
  )
}

export default Settings
