import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion as Motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Plus, X, Sparkles, Users } from 'lucide-react'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'

function Onboarding() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const { t } = useI18n()

  const [step, setStep] = useState(1)
  const [displayName, setDisplayName] = useState('')
  const [userRole, setUserRole] = useState('')
  const [roles, setRoles] = useState([])
  const [newRole, setNewRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
      return
    }
    async function loadExisting() {
      const snap = await getDoc(doc(db, 'users', currentUser.uid))
      if (snap.exists()) {
        const data = snap.data()
        if (data.onboarded) {
          navigate(data.accountType === 'employee' ? '/my-schedule' : '/dashboard')
          return
        }
        if (data.displayName) setDisplayName(data.displayName)
        if (data.userRole) setUserRole(data.userRole)
        if (data.roles) setRoles(data.roles)
      }
      setLoading(false)
    }
    loadExisting()
  }, [currentUser, navigate])

  function addRole() {
    const t = newRole.trim()
    if (!t) return
    if (roles.some(r => r.name.toLowerCase() === t.toLowerCase())) {
      toast.info(t('toastRoleAlreadyAdded'))
      return
    }
    setRoles([...roles, { id: Date.now().toString(), name: t }])
    setNewRole('')
  }

  function removeRole(id) {
    setRoles(roles.filter(r => r.id !== id))
  }

  async function handleStep1Next() {
    if (!displayName.trim()) {
      toast.info(t('toastEnterYourName'))
      return
    }
    if (!userRole.trim()) {
      toast.info(t('toastEnterYourRole'))
      return
    }
    setStep(2)
  }

  async function finishOnboarding() {
    if (roles.length === 0) {
      toast.info(t('toastAddAtLeastOneRole'))
      return
    }
    try {
      setSaving(true)
      await setDoc(doc(db, 'users', currentUser.uid), {
        email: currentUser.email,
        displayName: displayName.trim(),
        userRole: userRole.trim(),
        roles,
        onboarded: true,
        createdAt: serverTimestamp(),
      }, { merge: true })
      navigate('/dashboard')
    } catch (err) {
      console.error(err)
      toast.error(t('toastFailedAdd'))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <div className="empty-state"><p>{t('loading')}</p></div>
      </main>
    )
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
        className="auth-card onboarding-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="onboarding-progress">
          <div className={`onboarding-dot ${step >= 1 ? 'active' : ''}`} />
          <div className="onboarding-progress-line" />
          <div className={`onboarding-dot ${step >= 2 ? 'active' : ''}`} />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <Motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="auth-eyebrow">
                <Sparkles size={14} />
                <span>{t('onboardingStep1')}</span>
              </div>
              <h1 className="auth-title">{t('onboardingTitle1')}</h1>
              <p className="auth-subtitle">
                {t('onboardingSubtitle1')}
              </p>

              <div className="auth-form">
                <div className="auth-field">
                  <label className="form-label">{t('yourName')}</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={t('employeeNamePlaceholder')}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="auth-field">
                  <label className="form-label">{t('yourRoleQuestion')}</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={t('roleExamplePlaceholder')}
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleStep1Next()}
                  />
                </div>

                <button 
                  className="landing-cta-primary auth-submit"
                  onClick={handleStep1Next}
                >
                  <span>{t('continue')}</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </Motion.div>
          )}

          {step === 2 && (
            <Motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="auth-eyebrow">
                <Users size={14} />
                <span>{t('onboardingStep2')}</span>
              </div>
              <h1 className="auth-title">{t('onboardingTitle2')}</h1>
              <p className="auth-subtitle">
                {t('onboardingSubtitle2')}
              </p>

              <div className="auth-form">
                <div className="inline-form-row">
                  <input
                    type="text"
                    className="input"
                    placeholder={t('baristaPlaceholder')}
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRole())}
                    autoFocus
                  />
                  <button className="add-button" onClick={addRole}>
                    <Plus size={14} />
                    <span>{t('add')}</span>
                  </button>
                </div>

                {roles.length > 0 && (
                  <div className="onboarding-roles">
                    {roles.map(r => (
                      <div key={r.id} className="onboarding-role-chip">
                        <span>{r.name}</span>
                        <button 
                          onClick={() => removeRole(r.id)}
                          aria-label={`Remove ${r.name}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="onboarding-actions">
                  <button 
                    className="settings-button"
                    onClick={() => setStep(1)}
                    disabled={saving}
                  >
                    {t('back')}
                  </button>
                  <button 
                    className="landing-cta-primary"
                    onClick={finishOnboarding}
                    disabled={saving || roles.length === 0}
                  >
                    <span>{saving ? t('settingUp') : t('finishSetup')}</span>
                    {!saving && <ArrowRight size={16} />}
                  </button>
                </div>
              </div>
            </Motion.div>
          )}
        </AnimatePresence>
      </Motion.div>
    </main>
  )
}

export default Onboarding
