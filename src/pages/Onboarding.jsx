import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Plus, X, Sparkles, Users } from 'lucide-react'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'

function Onboarding() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()

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
          navigate('/dashboard')
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
      toast.info('You already added that role')
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
      toast.info('Please enter your name')
      return
    }
    if (!userRole.trim()) {
      toast.info('Please enter what you do')
      return
    }
    setStep(2)
  }

  async function finishOnboarding() {
    if (roles.length === 0) {
      toast.info('Add at least one role')
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
      toast.error('Failed to save. Try again.')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <div className="empty-state"><p>Loading...</p></div>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <div className="auth-bg">
        <motion.div 
          className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <motion.div
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
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="auth-eyebrow">
                <Sparkles size={14} />
                <span>Step 1 of 2</span>
              </div>
              <h1 className="auth-title">Let's get to know you</h1>
              <p className="auth-subtitle">
                Tell us who you are so we can personalize Zaman.
              </p>

              <div className="auth-form">
                <div className="auth-field">
                  <label className="form-label">Your name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Sam"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="auth-field">
                  <label className="form-label">What do you do?</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Shift Manager at a coffee shop"
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleStep1Next()}
                  />
                </div>

                <button 
                  className="landing-cta-primary auth-submit"
                  onClick={handleStep1Next}
                >
                  <span>Continue</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="auth-eyebrow">
                <Users size={14} />
                <span>Step 2 of 2</span>
              </div>
              <h1 className="auth-title">What roles does your team have?</h1>
              <p className="auth-subtitle">
                Add each role on your team. You can edit these later.
              </p>

              <div className="auth-form">
                <div className="inline-form-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Barista"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRole())}
                    autoFocus
                  />
                  <button className="add-button" onClick={addRole}>
                    <Plus size={14} />
                    <span>Add</span>
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
                    Back
                  </button>
                  <button 
                    className="landing-cta-primary"
                    onClick={finishOnboarding}
                    disabled={saving || roles.length === 0}
                  >
                    <span>{saving ? 'Setting up...' : 'Finish setup'}</span>
                    {!saving && <ArrowRight size={16} />}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  )
}

export default Onboarding