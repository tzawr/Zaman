import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, X, ArrowRight, Palmtree, Plus, Clock } from 'lucide-react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
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

const DEFAULT_AVAIL = DAYS.reduce((acc, d) => {
  acc[d.key] = { available: true, start: '09:00', end: '17:00' }
  return acc
}, {})

function Availability() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()

  const [employee, setEmployee] = useState(null)
  const [availability, setAvailability] = useState(DEFAULT_AVAIL)
  const [timeOff, setTimeOff] = useState([])
  const [newTimeOffStart, setNewTimeOffStart] = useState('')
  const [newTimeOffEnd, setNewTimeOffEnd] = useState('')
  const [newTimeOffReason, setNewTimeOffReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  useEffect(() => {
    if (!currentUser || !employeeId) return
    const unsub = onSnapshot(doc(db, 'employees', employeeId), (snap) => {
      if (!snap.exists()) {
        navigate('/employees')
        return
      }
      const data = snap.data()
      if (data.userId !== currentUser.uid) {
        navigate('/employees')
        return
      }
      setEmployee(data)
      if (data.availability && Object.keys(data.availability).length > 0) {
        setAvailability({ ...DEFAULT_AVAIL, ...data.availability })
      }
      setTimeOff(data.timeOff || [])
      setLoading(false)
    })
    return () => unsub()
  }, [currentUser, employeeId, navigate])

  async function saveAvailability(next) {
    try {
      setSaving(true)
      await updateDoc(doc(db, 'employees', employeeId), { availability: next })
    } catch (err) {
      toast.error('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function saveTimeOff(next) {
    try {
      setSaving(true)
      await updateDoc(doc(db, 'employees', employeeId), { timeOff: next })
    } catch (err) {
      toast.error('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(dayKey) {
    const next = {
      ...availability,
      [dayKey]: { ...availability[dayKey], available: !availability[dayKey].available }
    }
    setAvailability(next)
    saveAvailability(next)
  }

  function updateTime(dayKey, field, value) {
    const next = {
      ...availability,
      [dayKey]: { ...availability[dayKey], [field]: value }
    }
    setAvailability(next)
    saveAvailability(next)
  }

  function addTimeOff() {
    if (!newTimeOffStart || !newTimeOffEnd) {
      toast.info('Please pick both dates')
      return
    }
    if (newTimeOffEnd < newTimeOffStart) {
      toast.info('End must be after start')
      return
    }
    const entry = {
      id: Date.now().toString(),
      start: newTimeOffStart,
      end: newTimeOffEnd,
      reason: newTimeOffReason.trim() || 'Time off'
    }
    const next = [...timeOff, entry]
    setTimeOff(next)
    saveTimeOff(next)
    setNewTimeOffStart('')
    setNewTimeOffEnd('')
    setNewTimeOffReason('')
    toast.success('Time off added')
  }

  function removeTimeOff(id) {
    const next = timeOff.filter(t => t.id !== id)
    setTimeOff(next)
    saveTimeOff(next)
  }

  if (loading || !employee) {
    return (
      <main className="app-page">
        <div className="empty-state"><p>Loading...</p></div>
      </main>
    )
  }

  return (
    <main className="app-page">
      <button 
        className="app-back-link"
        onClick={() => navigate('/employees')}
      >
        <ArrowLeft size={14} />
        <span>Back to team</span>
      </button>

      <PageHero
        eyebrow={employee.role}
        title={employee.name}
        subtitle={`Set weekly availability and time off for ${employee.name}. Changes save automatically.`}
      >
        {saving && (
          <span className="saving-pill">
            <Clock size={12} />
            Saving...
          </span>
        )}
      </PageHero>

      <Section 
        title="Weekly availability" 
        subtitle="What hours are they available each day?"
        icon={Clock}
      >
        <div className="day-list">
          {DAYS.map(day => {
            const d = availability[day.key]
            return (
              <div key={day.key} className={`day-row ${d.available ? 'available' : 'unavailable'}`}>
                <button 
                  className="day-toggle"
                  onClick={() => toggleDay(day.key)}
                  aria-label={`Toggle ${day.label}`}
                >
                  <span className="day-name">{day.label}</span>
                  <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {d.available ? (
                      <>
                        <Check size={16} aria-hidden />
                        <span>Available</span>
                      </>
                    ) : (
                      <>
                        <X size={16} aria-hidden />
                        <span>Off</span>
                      </>
                    )}
                  </span>
                </button>
                {d.available && (
                  <div className="time-inputs">
                    <input
                      type="time"
                      className="time-input"
                      value={d.start}
                      onChange={(e) => updateTime(day.key, 'start', e.target.value)}
                    />
                    <span className="time-arrow"><ArrowRight size={16} /></span>
                    <input
                      type="time"
                      className="time-input"
                      value={d.end}
                      onChange={(e) => updateTime(day.key, 'end', e.target.value)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section 
        title="Time off" 
        subtitle="Vacation, appointments, or any dates they can't work."
        icon={Palmtree}
      >
        {timeOff.length > 0 && (
          <div className="timeoff-list">
            {timeOff.map(t => (
              <div key={t.id} className="timeoff-item">
                <div className="timeoff-info">
                  <div className="timeoff-dates">{t.start} → {t.end}</div>
                  <div className="timeoff-reason">{t.reason}</div>
                </div>
                <button 
                  className="timeoff-remove"
                  onClick={() => removeTimeOff(t.id)}
                  aria-label="Remove time off"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="timeoff-form">
          <div className="timeoff-form-row">
            <div className="employee-form-field">
              <label className="form-label">From</label>
              <input
                type="date"
                className="input"
                value={newTimeOffStart}
                onChange={(e) => setNewTimeOffStart(e.target.value)}
              />
            </div>
            <div className="employee-form-field">
              <label className="form-label">To</label>
              <input
                type="date"
                className="input"
                value={newTimeOffEnd}
                onChange={(e) => setNewTimeOffEnd(e.target.value)}
              />
            </div>
            <div className="employee-form-field" style={{ flex: 2 }}>
              <label className="form-label">Reason (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. vacation"
                value={newTimeOffReason}
                onChange={(e) => setNewTimeOffReason(e.target.value)}
              />
            </div>
          </div>
          <button className="add-button" onClick={addTimeOff}>
            <Plus size={14} />
            <span>Add time off</span>
          </button>
        </div>
      </Section>
    </main>
  )
}

export default Availability