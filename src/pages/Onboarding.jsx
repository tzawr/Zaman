import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function Onboarding() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // Step 1 data
  const [displayName, setDisplayName] = useState('')
  const [userRole, setUserRole] = useState('')  
  // Step 2 data
  const [roles, setRoles] = useState([])
  const [newRoleName, setNewRoleName] = useState('')

  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
    }
  }, [currentUser, navigate])

  function goToStep2(e) {
    e.preventDefault()
    setError('')
    if (!displayName.trim()) {
      return setError('Please enter your name')
    }
    if (!userRole.trim()) {
      return setError('Please enter your role')
    }
    setStep(2)
  }

  function addRole() {
    const trimmed = newRoleName.trim()
    if (!trimmed) return
    
    if (roles.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('That role already exists')
      return
    }
    
    const newRole = {
      id: Date.now().toString(),
      name: trimmed,
      canCover: [trimmed],
      color: '#4A90E2'
    }
    
    setRoles([...roles, newRole])
    setNewRoleName('')
    setError('')
  }

  function removeRole(id) {
    setRoles(roles.filter(r => r.id !== id))
  }

  async function finishOnboarding() {
    setError('')
    
    if (roles.length === 0) {
      return setError('Please add at least one role')
    }
    
    try {
      setLoading(true)
      await setDoc(doc(db, 'users', currentUser.uid), {
        displayName: displayName.trim(),
        userRole: userRole,
        roles: roles,
        email: currentUser.email,
        createdAt: serverTimestamp(),
        onboarded: true
      })
      navigate('/employees')
    } catch (err) {
      console.error('Onboarding error:', err)
      setError('Failed to save. Try again.')
      setLoading(false)
    }
  }

  if (!currentUser) return null

  return (
    <main className="auth-page">
      <div className="auth-card onboarding-card">
        <div className="step-indicator">
          <div className={`step-dot ${step >= 1 ? 'active' : ''}`}>1</div>
          <div className="step-line"></div>
          <div className={`step-dot ${step >= 2 ? 'active' : ''}`}>2</div>
        </div>

        {step === 1 && (
          <>
            <h2 className="auth-title">Let's set you up</h2>
            <p className="auth-subtitle">Tell us a bit about yourself.</p>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={goToStep2} className="auth-form">
              <label className="auth-label">Your Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Daniel, Sarah, or your nickname"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
              />

<label className="auth-label">Your Role</label>
<input
  type="text"
  className="input"
  placeholder="e.g. Store Manager, Owner, Head of Operations..."
  value={userRole}
  onChange={(e) => setUserRole(e.target.value)}
/>

              <button type="submit" className="auth-button">
                Continue →
              </button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="auth-title">Your team's roles</h2>
            <p className="auth-subtitle">
              What roles are on your team? Add all the positions you schedule.
            </p>

            {error && <div className="auth-error">{error}</div>}

            <div className="role-input-row">
              <input
                type="text"
                className="input"
                placeholder="e.g. Barista, Server, Cashier..."
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRole())}
                autoFocus
              />
              <button type="button" className="add-button" onClick={addRole}>
                Add
              </button>
            </div>

            <div className="role-list">
              {roles.length === 0 ? (
                <div className="empty-state small">
                  <p>No roles yet. Add your first above 👆</p>
                </div>
              ) : (
                roles.map(role => (
                  <div key={role.id} className="role-chip">
                    <span>{role.name}</span>
                    <button 
                      className="role-remove"
                      onClick={() => removeRole(role.id)}
                      aria-label={`Remove ${role.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="onboarding-actions">
              <button 
                type="button"
                className="secondary-button"
                onClick={() => setStep(1)}
              >
                ← Back
              </button>
              <button 
                type="button"
                className="auth-button flex-button"
                onClick={finishOnboarding}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Finish Setup'}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default Onboarding