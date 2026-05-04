import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, X, ArrowRight, Palmtree, Plus, Clock, Lock } from 'lucide-react'
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
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

const DEFAULT_AVAIL = DAYS.reduce((acc, d) => {
  acc[d.key] = { available: true, start: '09:00', end: '17:00' }
  return acc
}, {})

function Availability() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const { t } = useI18n()

  const [activeEmployeeId, setActiveEmployeeId] = useState(employeeId || '')
  const [employee, setEmployee] = useState(null)
  const [portalMode] = useState(employeeId ? 'manager' : 'employee')
  const [employeeCanEdit, setEmployeeCanEdit] = useState(!!employeeId)
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
      return
    }

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
        name: userData.employeeName || userData.displayName || t('myAvailability'),
        role: userData.employeeRole || t('employee'),
      })
      if (userData.availability && Object.keys(userData.availability).length > 0) {
        setAvailability({ ...DEFAULT_AVAIL, ...userData.availability })
      }
      setTimeOff(userData.timeOff || [])
      setLoading(false)
    }, () => {
      toast.error(t('availabilityPortalLoadError'))
      navigate('/my-schedule')
    })

    return () => unsub()
  }, [currentUser, employeeId, navigate, toast, t])

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
      toast.error(t('employeeAvailabilityLoadError'))
      navigate('/employees')
    })
    return () => unsub()
  }, [currentUser, activeEmployeeId, portalMode, navigate, toast, t])

  const canEdit = portalMode === 'manager' || employeeCanEdit
  const isEmployeePortal = portalMode === 'employee'
  const backPath = isEmployeePortal ? '/my-schedule' : '/employees'

  async function saveAvailability(next) {
    if (!canEdit) {
      toast.info(t('availabilityManagedByManager'))
      return
    }
    try {
      setSaving(true)
      const payload = {
        availability: next,
        availabilityUpdatedAt: serverTimestamp(),
        availabilityUpdatedBy: currentUser.uid,
        availabilityUpdatedByType: isEmployeePortal ? 'employee' : 'manager'
      }
      if (isEmployeePortal) {
        await updateDoc(doc(db, 'users', currentUser.uid), payload)
        try {
          await updateDoc(doc(db, 'employees', activeEmployeeId), payload)
        } catch {
          // The employee's own portal doc still records the submission.
          // Manager-owned employee records may be protected by Firestore rules.
        }
      } else {
        await updateDoc(doc(db, 'employees', activeEmployeeId), payload)
      }
    } catch {
      toast.error(t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  async function saveTimeOff(next) {
    if (!canEdit) {
      toast.info(t('timeOffManagedByManager'))
      return
    }
    try {
      setSaving(true)
      const payload = {
        timeOff: next,
        timeOffUpdatedAt: serverTimestamp(),
        timeOffUpdatedBy: currentUser.uid,
        timeOffUpdatedByType: isEmployeePortal ? 'employee' : 'manager'
      }
      if (isEmployeePortal) {
        await updateDoc(doc(db, 'users', currentUser.uid), payload)
        try {
          await updateDoc(doc(db, 'employees', activeEmployeeId), payload)
        } catch {
          // Keep the portal save successful even when employee records are
          // manager-owned by Firestore rules.
        }
      } else {
        await updateDoc(doc(db, 'employees', activeEmployeeId), payload)
      }
    } catch {
      toast.error(t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(dayKey) {
    if (!canEdit) {
      toast.info(t('availabilityManagedByManager'))
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
      toast.info(t('timeOffManagedByManager'))
      return
    }
    if (!newTimeOffStart || !newTimeOffEnd) {
      toast.info(t('pickBothDates'))
      return
    }
    if (newTimeOffEnd < newTimeOffStart) {
      toast.info(t('endAfterStart'))
      return
    }
    const entry = {
      id: Date.now().toString(),
      start: newTimeOffStart,
      end: newTimeOffEnd,
      reason: newTimeOffReason.trim() || t('timeOff')
    }
    const next = [...timeOff, entry]
    setTimeOff(next)
    saveTimeOff(next)
    setNewTimeOffStart('')
    setNewTimeOffEnd('')
    setNewTimeOffReason('')
    toast.success(t('timeOffAdded'))
  }

  function removeTimeOff(id) {
    if (!canEdit) {
      toast.info(t('timeOffManagedByManager'))
      return
    }
    const next = timeOff.filter(entry => entry.id !== id)
    setTimeOff(next)
    saveTimeOff(next)
  }

  if (loading || !employee) {
    return (
      <main className="app-page">
        <div className="empty-state"><p>{t('loading')}</p></div>
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
        <span>{isEmployeePortal ? t('backToMySchedule') : t('backToTeam')}</span>
      </button>

      <PageHero
        eyebrow={isEmployeePortal ? t('employeePortal') : employee.role}
        title={isEmployeePortal ? t('myAvailability') : employee.name}
        subtitle={
          isEmployeePortal
            ? canEdit
              ? t('availabilityEmployeeSubtitleEdit')
              : t('availabilityEmployeeSubtitleLocked')
            : `${t('availabilityManagerSubtitleBefore')} ${employee.name}. ${t('availabilityManagerSubtitleAfter')}`
        }
      >
        {saving && (
          <span className="saving-pill">
            <Clock size={12} />
            {t('saving')}
          </span>
        )}
        {isEmployeePortal && !canEdit && (
          <span className="saving-pill">
            <Lock size={12} />
            {t('managerControlled')}
          </span>
        )}
      </PageHero>

      <Section 
        title={t('weeklyAvailability')}
        subtitle={isEmployeePortal ? t('weeklyAvailabilityEmployeeSubtitle') : t('weeklyAvailabilityManagerSubtitle')}
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
                  aria-label={`${t('availability')} ${t(day.labelKey)}`}
                >
                  <span className="day-name">{t(day.labelKey)}</span>
                  <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {d.available ? (
                      <>
                        <Check size={16} aria-hidden />
                        <span>{t('available')}</span>
                      </>
                    ) : (
                      <>
                        <X size={16} aria-hidden />
                        <span>{t('off')}</span>
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
        title={isEmployeePortal ? t('timeOffRequests') : t('timeOff')}
        subtitle={isEmployeePortal ? t('timeOffEmployeeSubtitle') : t('timeOffManagerSubtitle')}
        icon={Palmtree}
      >
        {timeOff.length > 0 && (
          <div className="timeoff-list">
            {timeOff.map(entry => (
              <div key={entry.id} className="timeoff-item">
                <div className="timeoff-info">
                  <div className="timeoff-dates">{entry.start} → {entry.end}</div>
                  <div className="timeoff-reason">{entry.reason}</div>
                </div>
                <button 
                  className="timeoff-remove"
                  onClick={() => removeTimeOff(entry.id)}
                  disabled={!canEdit}
                  aria-label={t('removeTimeOff')}
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
              <label className="form-label">{t('from')}</label>
              <input
                type="date"
                className="input"
                value={newTimeOffStart}
                disabled={!canEdit}
                onChange={(e) => setNewTimeOffStart(e.target.value)}
              />
            </div>
            <div className="employee-form-field">
              <label className="form-label">{t('to')}</label>
              <input
                type="date"
                className="input"
                value={newTimeOffEnd}
                disabled={!canEdit}
                onChange={(e) => setNewTimeOffEnd(e.target.value)}
              />
            </div>
            <div className="employee-form-field" style={{ flex: 2 }}>
              <label className="form-label">{t('reasonOptional')}</label>
              <input
                type="text"
                className="input"
                placeholder={t('vacationPlaceholder')}
                value={newTimeOffReason}
                disabled={!canEdit}
                onChange={(e) => setNewTimeOffReason(e.target.value)}
              />
            </div>
          </div>
          <button className="add-button" onClick={addTimeOff} disabled={!canEdit}>
            <Plus size={14} />
            <span>{isEmployeePortal ? t('submitTimeOff') : t('addTimeOff')}</span>
          </button>
        </div>
      </Section>
    </main>
  )
}

export default Availability
