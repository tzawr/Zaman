import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ArrowLeft, Check, X, ArrowRight, Pencil, Trash2, Plus } from 'lucide-react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'

const DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' }
]

const DEFAULT_HOURS = DAYS.reduce((acc, day) => {
  acc[day.key] = { open: true, start: '07:00', end: '22:00' }
  return acc
}, {})

const DEFAULT_COVERAGE = DAYS.reduce((acc, day) => {
  acc[day.key] = { minPeople: 2 }
  return acc
}, {})

function Settings() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  
  const [operatingHours, setOperatingHours] = useState(DEFAULT_HOURS)
  const [coverage, setCoverage] = useState(DEFAULT_COVERAGE)
  const [preventClopening, setPreventClopening] = useState(true)
  const [minHoursBetweenShifts, setMinHoursBetweenShifts] = useState(10)
  const [roles, setRoles] = useState([])
  const [userData, setUserData] = useState(null)
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newRoleName, setNewRoleName] = useState('')
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleName, setEditingRoleName] = useState('')

  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
    }
  }, [currentUser, navigate])

  useEffect(() => {
    if (!currentUser) return

    const userRef = doc(db, 'users', currentUser.uid)
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data()
        if (!data.onboarded) {
          navigate('/onboarding')
          return
        }
        
        setUserData(data)
        if (data.operatingHours) setOperatingHours(data.operatingHours)
        if (data.coverage) setCoverage(data.coverage)
        if (data.preventClopening !== undefined) setPreventClopening(data.preventClopening)
        if (data.minHoursBetweenShifts) setMinHoursBetweenShifts(data.minHoursBetweenShifts)
        if (data.roles) setRoles(data.roles)
        
        setLoading(false)
      }
    })

    return () => unsubscribe()
  }, [currentUser, navigate])

  async function saveToFirebase(updates) {
    try {
      setSaving(true)
      await setDoc(
        doc(db, 'users', currentUser.uid),
        { ...updates, settingsUpdatedAt: serverTimestamp() },
        { merge: true }
      )
      setSaving(false)
    } catch (error) {
      console.error('Error saving:', error)
      setSaving(false)
      toast.error('Failed to save. Try again.')
    }
  }

  function toggleDay(dayKey) {
    const updated = {
      ...operatingHours,
      [dayKey]: {
        ...operatingHours[dayKey],
        open: !operatingHours[dayKey].open
      }
    }
    setOperatingHours(updated)
    saveToFirebase({ operatingHours: updated })
  }

  function updateHourTime(dayKey, field, value) {
    const updated = {
      ...operatingHours,
      [dayKey]: {
        ...operatingHours[dayKey],
        [field]: value
      }
    }
    setOperatingHours(updated)
    saveToFirebase({ operatingHours: updated })
  }

  function updateCoverage(dayKey, value) {
    const num = parseInt(value) || 0
    const updated = {
      ...coverage,
      [dayKey]: { minPeople: num }
    }
    setCoverage(updated)
    saveToFirebase({ coverage: updated })
  }

  function toggleClopeningPrevention() {
    const newValue = !preventClopening
    setPreventClopening(newValue)
    saveToFirebase({ preventClopening: newValue })
  }

  function updateMinHours(value) {
    const num = parseInt(value) || 8
    setMinHoursBetweenShifts(num)
    saveToFirebase({ minHoursBetweenShifts: num })
  }

  // ===== ROLE FUNCTIONS =====
  async function addRole() {
    const trimmed = newRoleName.trim()
    if (!trimmed) {
      toast.info('Please enter a role name')
      return
    }
    
    if (roles.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.info('That role already exists')
      return
    }
    
    const newRole = {
      id: Date.now().toString(),
      name: trimmed
    }
    
    try {
      await saveToFirebase({ roles: [...roles, newRole] })
      setNewRoleName('')
      toast.success(`Added "${trimmed}"`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to add role')
    }
  }

  function startEditRole(role) {
    setEditingRoleId(role.id)
    setEditingRoleName(role.name)
  }

  async function saveEditRole() {
    const trimmed = editingRoleName.trim()
    if (!trimmed) {
      toast.info('Role name cannot be empty')
      return
    }
    
    const duplicate = roles.some(
      r => r.id !== editingRoleId && r.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (duplicate) {
      toast.info('Another role already has that name')
      return
    }
    
    const updatedRoles = roles.map(r =>
      r.id === editingRoleId ? { ...r, name: trimmed } : r
    )
    
    try {
      await saveToFirebase({ roles: updatedRoles })
      setEditingRoleId(null)
      setEditingRoleName('')
      toast.success('Role updated')
    } catch (err) {
      console.error(err)
      toast.error('Failed to update role')
    }
  }

  function cancelEditRole() {
    setEditingRoleId(null)
    setEditingRoleName('')
  }

  async function deleteRole(roleId, roleName) {
    if (!window.confirm(`Delete the "${roleName}" role?`)) {
      return
    }
    
    const updatedRoles = roles.filter(r => r.id !== roleId)
    
    try {
      await saveToFirebase({ roles: updatedRoles })
      toast.success(`Deleted "${roleName}"`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete role')
    }
  }

  if (loading) {
    return (
      <main className="availability-page">
        <div className="empty-state">
          <p>Loading settings... <Loader2 size={16} className="spin" aria-hidden /></p>
        </div>
      </main>
    )
  }

  return (
    <main className="availability-page">
      <div className="page-header availability-header">
        <button
          className="back-link"
          onClick={() => navigate('/dashboard')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowLeft size={16} aria-hidden />
          <span>Back to dashboard</span>
        </button>
        
        <div className="employee-header">
          <div>
            <h2 className="page-title no-margin">Settings</h2>
            <p className="page-subtitle">Configure how Zaman builds your schedules.</p>
          </div>
          {saving && <span className="saving-badge">Saving...</span>}
        </div>
      </div>

      {/* Roles Section */}
      <div className="availability-section">
        <h3 className="section-title">Roles</h3>
        <p className="section-subtitle">
          The roles you can assign to your team. Add or edit anytime.
        </p>
        
        <div className="roles-list">
          {roles.map(role => (
            <div key={role.id} className="role-item">
              {editingRoleId === role.id ? (
                <>
                  <input
                    type="text"
                    className="input role-edit-input"
                    value={editingRoleName}
                    onChange={(e) => setEditingRoleName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEditRole()
                      if (e.key === 'Escape') cancelEditRole()
                    }}
                    autoFocus
                  />
                  <div className="role-actions">
                    <button 
                      className="role-save-btn"
                      onClick={saveEditRole}
                    >
                      <Check size={16} />
                    </button>
                    <button 
                      className="role-cancel-btn"
                      onClick={cancelEditRole}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="role-name">{role.name}</div>
                  <div className="role-actions">
                    <button 
                      className="role-edit-btn"
                      onClick={() => startEditRole(role)}
                      aria-label="Edit role"
                    >
                      <Pencil size={14} />
                    </button>
                    <button 
                      className="role-delete-btn"
                      onClick={() => deleteRole(role.id, role.name)}
                      aria-label="Delete role"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          
          {roles.length === 0 && (
            <p className="role-empty">No roles yet. Add your first one below.</p>
          )}
        </div>

        <div className="role-add-row">
          <input
            type="text"
            className="input"
            placeholder="e.g. Cashier, Barista, Manager"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRole()}
          />
          <button 
            className="add-button"
            onClick={addRole}
          >
            <Plus size={16} />
            <span>Add role</span>
          </button>
        </div>
      </div>

      {/* Operating Hours */}
      <div className="availability-section">
        <h3 className="section-title">Operating Hours</h3>
        <p className="section-subtitle">When your business is open.</p>
        
        <div className="day-list">
          {DAYS.map(day => {
            const dayData = operatingHours[day.key]
            return (
              <div 
                key={day.key} 
                className={`day-row ${dayData.open ? 'available' : 'unavailable'}`}
              >
                <button 
                  className="day-toggle"
                  onClick={() => toggleDay(day.key)}
                  aria-label={`Toggle ${day.label}`}
                >
                  <span className="day-name">{day.label}</span>
                  <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {dayData.open ? (
                      <>
                        <Check size={16} aria-hidden />
                        <span>Open</span>
                      </>
                    ) : (
                      <>
                        <X size={16} aria-hidden />
                        <span>Closed</span>
                      </>
                    )}
                  </span>
                </button>
                
                {dayData.open && (
                  <div className="time-inputs">
                    <input
                      type="time"
                      className="time-input"
                      value={dayData.start}
                      onChange={(e) => updateHourTime(day.key, 'start', e.target.value)}
                    />
                    <span className="time-arrow"><ArrowRight size={16} aria-hidden /></span>
                    <input
                      type="time"
                      className="time-input"
                      value={dayData.end}
                      onChange={(e) => updateHourTime(day.key, 'end', e.target.value)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Coverage Minimums */}
      <div className="availability-section">
        <h3 className="section-title">Coverage Minimums</h3>
        <p className="section-subtitle">
          Minimum number of people working at any time during open hours.
        </p>
        
        <div className="day-list">
          {DAYS.map(day => {
            const dayData = operatingHours[day.key]
            const cov = coverage[day.key]?.minPeople ?? 2
            return (
              <div 
                key={day.key} 
                className={`day-row ${dayData.open ? 'available' : 'unavailable'}`}
              >
                <div className="day-toggle">
                  <span className="day-name">{day.label}</span>
                  <span className="day-status">
                    {dayData.open ? 'Open' : 'Closed'}
                  </span>
                </div>
                
                {dayData.open && (
                  <div className="coverage-input-wrapper">
                    <input
                      type="number"
                      min="1"
                      max="20"
                      className="time-input coverage-input"
                      value={cov}
                      onChange={(e) => updateCoverage(day.key, e.target.value)}
                    />
                    <span className="coverage-label">
                      {cov === 1 ? 'person' : 'people'} min
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Scheduling Rules */}
      <div className="availability-section">
        <h3 className="section-title">Scheduling Rules</h3>
        <p className="section-subtitle">Rules the AI will follow when building schedules.</p>
        
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">Prevent Clopening</p>
            <p className="rule-description">
              Don't schedule someone to close then open the next day.
            </p>
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
              <p className="rule-title">Minimum hours between shifts</p>
              <p className="rule-description">
                How many hours off between a shift ending and the next one starting.
              </p>
            </div>
            <div className="coverage-input-wrapper">
              <input
                type="number"
                min="6"
                max="24"
                className="time-input coverage-input"
                value={minHoursBetweenShifts}
                onChange={(e) => updateMinHours(e.target.value)}
              />
              <span className="coverage-label">hours</span>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default Settings