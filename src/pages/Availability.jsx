import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, X, ArrowRight, Palmtree, Plus, Clock, Lock } from 'lucide-react'
import { collection, doc, onSnapshot, query, updateDoc, where, serverTimestamp } from 'firebase/firestore'
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

function timestampMs(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return 0
}

function hasValue(record, field) {
  if (!record?.[field]) return false
  if (Array.isArray(record[field])) return record[field].length > 0
  return Object.keys(record[field]).length > 0
}

function freshestRecord(records, field, timestampField) {
  return records
    .filter(record => hasValue(record, field))
    .sort((a, b) => timestampMs(b[timestampField]) - timestampMs(a[timestampField]))[0]
}

const MINUTES = ['00', '15', '30', '45']

function TimeSelect({ value, disabled, onChange }) {
  const [rawH = '09', rawM = '00'] = (value || '09:00').split(':')
  const totalH = parseInt(rawH, 10)
  const period = totalH < 12 ? 'AM' : 'PM'
  const h12 = totalH === 0 ? 12 : totalH > 12 ? totalH - 12 : totalH
  const m = MINUTES.includes(rawM) ? rawM : '00'

  function emit(newH12, newM, newPeriod) {
    let h24
    if (newPeriod === 'AM') h24 = newH12 === 12 ? 0 : newH12
    else h24 = newH12 === 12 ? 12 : newH12 + 12
    onChange(`${String(h24).padStart(2, '0')}:${newM}`)
  }

  return (
    <div className={`time-select${disabled ? ' disabled' : ''}`}>
      <select className="time-select-hour" value={h12} disabled={disabled}
        onChange={e => emit(parseInt(e.target.value, 10), m, period)}>
        {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="time-select-colon">:</span>
      <select className="time-select-min" value={m} disabled={disabled}
        onChange={e => emit(h12, e.target.value, period)}>
        {MINUTES.map(min => <option key={min} value={min}>{min}</option>)}
      </select>
      <button type="button" className="time-select-ampm" disabled={disabled}
        onClick={() => emit(h12, m, period === 'AM' ? 'PM' : 'AM')}>
        {period}
      </button>
    </div>
  )
}

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
  const [linkedPortalUserId, setLinkedPortalUserId] = useState('')
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

    let userRecord = null
    let employeeRecord = null
    let unsubEmployee = null

    function applyRecords() {
      if (!userRecord) return

      setActiveEmployeeId(userRecord.linkedEmployeeId)
      setEmployeeCanEdit(userRecord.allowEmployeeAvailabilityUpdates !== false)
      setEmployee({
        name: userRecord.employeeName || userRecord.displayName || t('myAvailability'),
        role: userRecord.employeeRole || t('employee'),
      })

      const availabilityRecord = freshestRecord(
        [userRecord, employeeRecord],
        'availability',
        'availabilityUpdatedAt'
      )
      const timeOffRecord = freshestRecord(
        [userRecord, employeeRecord],
        'timeOff',
        'timeOffUpdatedAt'
      )
      setAvailability({ ...DEFAULT_AVAIL, ...(availabilityRecord?.availability || {}) })
      setTimeOff(timeOffRecord?.timeOff || [])
      setLoading(false)
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
      userRecord = userData
      if (!unsubEmployee) {
        unsubEmployee = onSnapshot(doc(db, 'employees', userData.linkedEmployeeId), (employeeSnap) => {
          employeeRecord = employeeSnap.exists() ? employeeSnap.data() : null
          applyRecords()
        }, () => {
          employeeRecord = null
          applyRecords()
        })
      }
      applyRecords()
    }, () => {
      toast.error(t('availabilityPortalLoadError'))
      navigate('/my-schedule')
    })

    return () => {
      unsub()
      if (unsubEmployee) unsubEmployee()
    }
  }, [currentUser, employeeId, navigate, toast, t])

  useEffect(() => {
    if (!currentUser || !activeEmployeeId || portalMode === 'employee') return
    let employeeRecord = null
    let portalRecord = null

    function applyRecords() {
      if (!employeeRecord) return
      const availabilityRecord = freshestRecord(
        [employeeRecord, portalRecord],
        'availability',
        'availabilityUpdatedAt'
      )
      const timeOffRecord = freshestRecord(
        [employeeRecord, portalRecord],
        'timeOff',
        'timeOffUpdatedAt'
      )
      setEmployee(employeeRecord)
      setAvailability({ ...DEFAULT_AVAIL, ...(availabilityRecord?.availability || {}) })
      setTimeOff(timeOffRecord?.timeOff || [])
      setLoading(false)
    }

    const unsubEmployee = onSnapshot(doc(db, 'employees', activeEmployeeId), (snap) => {
      if (!snap.exists()) {
        navigate('/employees')
        return
      }
      const data = snap.data()
      if (data.userId !== currentUser.uid) {
        navigate('/employees')
        return
      }
      employeeRecord = data
      applyRecords()
    }, () => {
      toast.error(t('employeeAvailabilityLoadError'))
      navigate('/employees')
    })

    // Two-field query matches the composite index Firebase auto-creates for
    // (managerId, accountType). The third field (linkedEmployeeId) was causing
    // a missing-index error that silently failed, leaving portalRecord always null.
    const portalQuery = query(
      collection(db, 'users'),
      where('managerId', '==', currentUser.uid),
      where('accountType', '==', 'employee')
    )
    const unsubPortal = onSnapshot(portalQuery, (snapshot) => {
      const portalDoc = snapshot.docs.find(d => d.data().linkedEmployeeId === activeEmployeeId)
      portalRecord = portalDoc ? portalDoc.data() : null
      setLinkedPortalUserId(portalDoc?.id || '')
      applyRecords()
    }, () => {
      portalRecord = null
      setLinkedPortalUserId('')
      applyRecords()
    })

    return () => {
      unsubEmployee()
      unsubPortal()
    }
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
        if (linkedPortalUserId) {
          try {
            await updateDoc(doc(db, 'users', linkedPortalUserId), payload)
          } catch {
            // The employee record remains the manager-owned source if rules
            // prevent managers from writing employee portal user docs.
          }
        }
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
        if (linkedPortalUserId) {
          try {
            await updateDoc(doc(db, 'users', linkedPortalUserId), payload)
          } catch {
            // The employee record remains the manager-owned source if rules
            // prevent managers from writing employee portal user docs.
          }
        }
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
                    <TimeSelect
                      value={d.start}
                      disabled={!canEdit}
                      onChange={val => updateTime(day.key, 'start', val)}
                    />
                    <span className="time-arrow"><ArrowRight size={16} /></span>
                    <TimeSelect
                      value={d.end}
                      disabled={!canEdit}
                      onChange={val => updateTime(day.key, 'end', val)}
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
