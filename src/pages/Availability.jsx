import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, X, ArrowRight, Palmtree, Plus, Clock, Lock } from 'lucide-react'
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
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

  const [activeEmployeeId, setActiveEmployeeId] = useState(employeeId || '')
  const [employee, setEmployee] = useState(null)
  const [portalMode, setPortalMode] = useState(employeeId ? 'manager' : 'employee')
  const [employeeCanEdit, setEmployeeCanEdit] = useState(false)
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
    if (!currentUser) return

    if (employeeId) {
      setPortalMode('manager')
      setEmployeeCanEdit(true)
      setActiveEmployeeId(employeeId)
      return
    }

    setPortalMode('employee')
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      if (!snap.exists()) {
        navigate('/signin')
        return
      }
      const userData = snap.data()
      if (userData.accountType !== 'employee' || !userData.linkedEmployeeId || !userData.managerId) {
        navigate('/dashboard')
        return
      }

      setActiveEmployeeId(userData.linkedEmployeeId)
      setEmployeeCanEdit(userData.allowEmployeeAvailabilityUpdates !== false)
      setEmployee({
        name: userData.employeeName || userData.displayName || 'My availability',
        role: userData.employeeRole || 'Employee',
      })
      if (userData.availability && Object.keys(userData.availability).length > 0) {
        setAvailability({ ...DEFAULT_AVAIL, ...userData.availability })
      }
      setTimeOff(userData.timeOff || [])
      setLoading(false)
    }, () => {
      toast.error('Failed to load availability portal.')
      navigate('/my-schedule')
    })

    return () => unsub()
  }, [currentUser, employeeId, navigate, toast])

  useEffect(() => {
    if (!currentUser || !activeEmployeeId || portalMode === 'employee') return
    const unsub = onSnapshot(doc(db, 'employees', activeEmployeeId), (snap) => {
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
    }, () => {
      toast.error('Failed to load employee availability.')
      navigate('/employees')
    })
    return () => unsub()
  }, [currentUser, activeEmployeeId, portalMode, navigate, toast])

  const canEdit = portalMode === 'manager' || employeeCanEdit
  const isEmployeePortal = portalMode === 'employee'
  const backPath = isEmployeePortal ? '/my-schedule' : '/employees'

  async function saveAvailability(next) {
    if (!canEdit) {
      toast.info('Your manager is managing availability right now.')
      return
    }
    try {
      setSaving(true)
      const targetRef = isEmployeePortal
        ? doc(db, 'users', currentUser.uid)
        : doc(db, 'employees', activeEmployeeId)
      await updateDoc(targetRef, {
        availability: next,
        availabilityUpdatedAt: serverTimestamp(),
        availabilityUpdatedBy: currentUser.uid,
        availabilityUpdatedByType: isEmployeePortal ? 'employee' : 'manager'
      })
    } catch {
      toast.error('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function saveTimeOff(next) {
    if (!canEdit) {
      toast.info('Your manager is managing time off right now.')
      return
    }
    try {
      setSaving(true)
      const targetRef = isEmployeePortal
        ? doc(db, 'users', currentUser.uid)
        : doc(db, 'employees', activeEmployeeId)
      await updateDoc(targetRef, {
        timeOff: next,
        timeOffUpdatedAt: serverTimestamp(),
        timeOffUpdatedBy: currentUser.uid,
        timeOffUpdatedByType: isEmployeePortal ? 'employee' : 'manager'
      })
    } catch {
      toast.error('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(dayKey) {
    if (!canEdit) {
      toast.info('Your manager is managing availability right now.')
      return
    }
    const next = {
      ...availability,
      [dayKey]: { ...availability[dayKey], available: !availability[dayKey].available }
    }
    setAvailability(next)
    saveAvailability(next)
  }

  function updateTime(dayKey, field, value) {
    if (!canEdit) return
    const next = {
      ...availability,
      [dayKey]: { ...availability[dayKey], [field]: value }
    }
    setAvailability(next)
    saveAvailability(next)
  }

  function addTimeOff() {
    if (!canEdit) {
      toast.info('Your manager is managing time off right now.')
      return
    }
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
    if (!canEdit) {
      toast.info('Your manager is managing time off right now.')
      return
    }
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
        onClick={() => navigate(backPath)}
      >
        <ArrowLeft size={14} />
        <span>{isEmployeePortal ? 'Back to my schedule' : 'Back to team'}</span>
      </button>

      <PageHero
        eyebrow={isEmployeePortal ? 'Employee portal' : employee.role}
        title={isEmployeePortal ? 'My availability' : employee.name}
        subtitle={
          isEmployeePortal
            ? canEdit
              ? 'Update your weekly availability and time off. Your manager sees the changes before building the next schedule.'
              : 'Your manager is managing availability right now. You can still review what is on file.'
            : `Set weekly availability and time off for ${employee.name}. Changes save automatically.`
        }
      >
        {saving && (
          <span className="saving-pill">
            <Clock size={12} />
            Saving...
          </span>
        )}
        {isEmployeePortal && !canEdit && (
          <span className="saving-pill">
            <Lock size={12} />
            Manager controlled
          </span>
        )}
      </PageHero>

      <Section 
        title="Weekly availability" 
        subtitle={isEmployeePortal ? 'What hours can you usually work each day?' : 'What hours are they available each day?'}
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
                  disabled={!canEdit}
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
                      disabled={!canEdit}
                      onChange={(e) => updateTime(day.key, 'start', e.target.value)}
                    />
                    <span className="time-arrow"><ArrowRight size={16} /></span>
                    <input
                      type="time"
                      className="time-input"
                      value={d.end}
                      disabled={!canEdit}
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
        title={isEmployeePortal ? 'Time off requests' : 'Time off'} 
        subtitle={isEmployeePortal ? 'Add dates you cannot work. Hengam uses these before your manager builds the next schedule.' : "Vacation, appointments, or any dates they can't work."}
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
                  disabled={!canEdit}
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
                disabled={!canEdit}
                onChange={(e) => setNewTimeOffStart(e.target.value)}
              />
            </div>
            <div className="employee-form-field">
              <label className="form-label">To</label>
              <input
                type="date"
                className="input"
                value={newTimeOffEnd}
                disabled={!canEdit}
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
                disabled={!canEdit}
                onChange={(e) => setNewTimeOffReason(e.target.value)}
              />
            </div>
          </div>
          <button className="add-button" onClick={addTimeOff} disabled={!canEdit}>
            <Plus size={14} />
            <span>{isEmployeePortal ? 'Submit time off' : 'Add time off'}</span>
          </button>
        </div>
      </Section>
    </main>
  )
}

export default Availability
