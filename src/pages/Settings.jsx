import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, ArrowLeft, Check, X, ArrowRight, Pencil, Trash2, Plus, Clock, Shield, Target, Users, Eye } from 'lucide-react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

const DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' }
]

const DEFAULT_HOURS = DAYS.reduce((acc, d) => {
  acc[d.key] = { open: true, start: '07:00', end: '22:00' }
  return acc
}, {})

const DEFAULT_COVERAGE = DAYS.reduce((acc, d) => {
  acc[d.key] = { minPeople: 2 }
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
  const [allowEmployeeFullView, setAllowEmployeeFullView] = useState(false)
  const [roles, setRoles] = useState([])
  const [userData, setUserData] = useState(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newRoleName, setNewRoleName] = useState('')
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleName, setEditingRoleName] = useState('')

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
        setUserData(d)
        if (d.operatingHours) setOperatingHours(d.operatingHours)
        if (d.coverage) setCoverage(d.coverage)
        if (d.preventClopening !== undefined) setPreventClopening(d.preventClopening)
        if (d.minHoursBetweenShifts) setMinHoursBetweenShifts(d.minHoursBetweenShifts)
        if (d.allowEmployeeFullView !== undefined) setAllowEmployeeFullView(d.allowEmployeeFullView)
        if (d.roles) setRoles(d.roles)
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
    } catch (err) {
      toast.error('Failed to save.')
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
  }
  function updateCoverage(k, v) {
    const n = parseInt(v) || 0
    const next = { ...coverage, [k]: { minPeople: n } }
    setCoverage(next); saveToFirebase({ coverage: next })
  }
  function toggleClopeningPrevention() {
    const v = !preventClopening; setPreventClopening(v); saveToFirebase({ preventClopening: v })
  }
  function toggleAllowEmployeeFullView() {
    const v = !allowEmployeeFullView; setAllowEmployeeFullView(v); saveToFirebase({ allowEmployeeFullView: v })
  }
  function updateMinHours(v) {
    const n = parseInt(v) || 8; setMinHoursBetweenShifts(n); saveToFirebase({ minHoursBetweenShifts: n })
  }

  // Roles
  async function addRole() {
    const t = newRoleName.trim()
    if (!t) { toast.info('Please enter a role name'); return }
    if (roles.some(r => r.name.toLowerCase() === t.toLowerCase())) {
      toast.info('That role already exists'); return
    }
    const next = [...roles, { id: Date.now().toString(), name: t }]
    await saveToFirebase({ roles: next })
    setNewRoleName('')
    toast.success(`Added "${t}"`)
  }
  function startEditRole(r) { setEditingRoleId(r.id); setEditingRoleName(r.name) }
  async function saveEditRole() {
    const t = editingRoleName.trim()
    if (!t) { toast.info('Role name cannot be empty'); return }
    if (roles.some(r => r.id !== editingRoleId && r.name.toLowerCase() === t.toLowerCase())) {
      toast.info('Another role has that name'); return
    }
    const next = roles.map(r => r.id === editingRoleId ? { ...r, name: t } : r)
    await saveToFirebase({ roles: next })
    setEditingRoleId(null); setEditingRoleName('')
    toast.success('Role updated')
  }
  function cancelEditRole() { setEditingRoleId(null); setEditingRoleName('') }
  async function deleteRole(id, name) {
    if (!window.confirm(`Delete the "${name}" role?`)) return
    const next = roles.filter(r => r.id !== id)
    await saveToFirebase({ roles: next })
    toast.success(`Deleted "${name}"`)
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

  return (
    <main className="app-page">
      <button className="app-back-link" onClick={() => navigate('/dashboard')}>
        <ArrowLeft size={14} />
        <span>Back to dashboard</span>
      </button>

      <PageHero
        eyebrow="Configuration"
        title="Settings"
        subtitle="Tell Zaman how your business operates. The AI uses these rules every time it builds a schedule."
      >
        {saving && (
          <span className="saving-pill">
            <Clock size={12} />
            Saving...
          </span>
        )}
      </PageHero>

      <Section 
        title="Roles" 
        subtitle="The roles you can assign to your team."
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
                    <button className="role-edit-btn" onClick={() => startEditRole(r)} aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <button className="role-delete-btn" onClick={() => deleteRole(r.id, r.name)} aria-label="Delete">
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
          <button className="add-button" onClick={addRole}>
            <Plus size={16} />
            <span>Add role</span>
          </button>
        </div>
      </Section>

      <Section 
        title="Operating hours" 
        subtitle="When your business is open for service."
        icon={Clock}
      >
        <div className="day-list">
          {DAYS.map(day => {
            const d = operatingHours[day.key]
            return (
              <div key={day.key} className={`day-row ${d.open ? 'available' : 'unavailable'}`}>
                <button className="day-toggle" onClick={() => toggleDay(day.key)}>
                  <span className="day-name">{day.label}</span>
                  <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {d.open ? <><Check size={16} /><span>Open</span></> : <><X size={16} /><span>Closed</span></>}
                  </span>
                </button>
                {d.open && (
                  <div className="time-inputs">
                    <input
                      type="time"
                      className="time-input"
                      value={d.start}
                      onChange={(e) => updateHourTime(day.key, 'start', e.target.value)}
                    />
                    <span className="time-arrow"><ArrowRight size={16} /></span>
                    <input
                      type="time"
                      className="time-input"
                      value={d.end}
                      onChange={(e) => updateHourTime(day.key, 'end', e.target.value)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section 
        title="Coverage minimums" 
        subtitle="How many people need to be working at any given time."
        icon={Target}
      >
        <div className="day-list">
          {DAYS.map(day => {
            const d = operatingHours[day.key]
            const c = coverage[day.key]?.minPeople ?? 2
            return (
              <div key={day.key} className={`day-row ${d.open ? 'available' : 'unavailable'}`}>
                <div className="day-toggle">
                  <span className="day-name">{day.label}</span>
                  <span className="day-status">{d.open ? 'Open' : 'Closed'}</span>
                </div>
                {d.open && (
                  <div className="coverage-input-wrapper">
                    <input
                      type="number"
                      min="1"
                      max="20"
                      className="time-input coverage-input"
                      value={c}
                      onChange={(e) => updateCoverage(day.key, e.target.value)}
                    />
                    <span className="coverage-label">{c === 1 ? 'person' : 'people'} min</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section 
        title="Scheduling rules" 
        subtitle="Constraints Claude will always respect when building schedules."
        icon={Shield}
      >
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">Prevent clopening</p>
            <p className="rule-description">Don't schedule someone to close one day and open the next.</p>
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
              <p className="rule-description">How many hours off required between shift end and next shift start.</p>
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
      </Section>

      <Section
        title="Team access"
        subtitle="Control what employees can see when they log in."
        icon={Eye}
      >
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">Let employees see the full schedule</p>
            <p className="rule-description">When on, employees can toggle between their own shifts and the full team schedule.</p>
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
      </Section>
    </main>
  )
}

export default Settings