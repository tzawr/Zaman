import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

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
  
  const [operatingHours, setOperatingHours] = useState(DEFAULT_HOURS)
  const [coverage, setCoverage] = useState(DEFAULT_COVERAGE)
  const [preventClopening, setPreventClopening] = useState(true)
  const [minHoursBetweenShifts, setMinHoursBetweenShifts] = useState(10)
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
        
        if (data.operatingHours) setOperatingHours(data.operatingHours)
        if (data.coverage) setCoverage(data.coverage)
        if (data.preventClopening !== undefined) setPreventClopening(data.preventClopening)
        if (data.minHoursBetweenShifts) setMinHoursBetweenShifts(data.minHoursBetweenShifts)
        
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
      alert('Failed to save. Try again.')
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

  if (loading) {
    return (
      <main className="availability-page">
        <div className="empty-state">
          <p>Loading settings... ⏳</p>
        </div>
      </main>
    )
  }

  return (
    <main className="availability-page">
      <div className="page-header availability-header">
        <button className="back-link" onClick={() => navigate('/employees')}>
          ← Back to team
        </button>
        
        <div className="employee-header">
          <div>
            <h2 className="page-title no-margin">Settings</h2>
            <p className="page-subtitle">Configure how Zaman builds your schedules.</p>
          </div>
          {saving && <span className="saving-badge">Saving...</span>}
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
                  <span className="day-status">
                    {dayData.open ? '✓ Open' : '✕ Closed'}
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
                    <span className="time-arrow">→</span>
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