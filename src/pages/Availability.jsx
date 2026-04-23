import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, ArrowLeft, Palmtree, Check, X, ArrowRight } from 'lucide-react'
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
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

const DEFAULT_AVAILABILITY = DAYS.reduce((acc, day) => {
  acc[day.key] = { available: true, start: '09:00', end: '17:00' }
  return acc
}, {})

function Availability() {
  const navigate = useNavigate()
  const { employeeId } = useParams()
  const { currentUser } = useAuth()
  const toast = useToast()
  
  const [employee, setEmployee] = useState(null)
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY)
  const [timeOffList, setTimeOffList] = useState([])
  const [newTimeOffStart, setNewTimeOffStart] = useState('')
  const [newTimeOffEnd, setNewTimeOffEnd] = useState('')
  const [newTimeOffReason, setNewTimeOffReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
    }
  }, [currentUser, navigate])

  // Load employee + availability data
  useEffect(() => {
    if (!currentUser || !employeeId) return

    const employeeRef = doc(db, 'employees', employeeId)
    
    const unsubscribe = onSnapshot(employeeRef, (snapshot) => {
      if (!snapshot.exists()) {
        navigate('/employees')
        return
      }
      
      const data = snapshot.data()
      
      if (data.userId !== currentUser.uid) {
        navigate('/employees')
        return
      }
      
      setEmployee({ id: snapshot.id, ...data })
      
      if (data.availability) {
        setAvailability(data.availability)
      }
      
      if (data.timeOff) {
        setTimeOffList(data.timeOff)
      }
      
      setLoading(false)
    }, (error) => {
      console.error('Error loading employee:', error)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [currentUser, employeeId, navigate])

  // Toggle a day's availability
  function toggleDay(dayKey) {
    const newAvailability = {
      ...availability,
      [dayKey]: {
        ...availability[dayKey],
        available: !availability[dayKey].available
      }
    }
    setAvailability(newAvailability)
    saveAvailability(newAvailability, timeOffList)
  }

  // Update a day's start or end time
  function updateTime(dayKey, field, value) {
    const newAvailability = {
      ...availability,
      [dayKey]: {
        ...availability[dayKey],
        [field]: value
      }
    }
    setAvailability(newAvailability)
    saveAvailability(newAvailability, timeOffList)
  }

  // Add a time off request
  function addTimeOff() {
    if (!newTimeOffStart || !newTimeOffEnd) {
      toast.info('Please pick both start and end dates')
      return
    }
    
    if (newTimeOffEnd < newTimeOffStart) {
      toast.info('End date must be after start date')
      return
    }
    
    const newTimeOff = {
      id: Date.now().toString(),
      start: newTimeOffStart,
      end: newTimeOffEnd,
      reason: newTimeOffReason.trim() || 'Time off'
    }
    
    const updated = [...timeOffList, newTimeOff]
    setTimeOffList(updated)
    saveAvailability(availability, updated)
    
    setNewTimeOffStart('')
    setNewTimeOffEnd('')
    setNewTimeOffReason('')
  }

  // Remove a time off request
  function removeTimeOff(id) {
    const updated = timeOffList.filter(t => t.id !== id)
    setTimeOffList(updated)
    saveAvailability(availability, updated)
  }

  // Save to Firebase
  async function saveAvailability(newAvailability, newTimeOff) {
    if (!employeeId) return
    
    try {
      setSaving(true)
      await setDoc(
        doc(db, 'employees', employeeId),
        {
          availability: newAvailability,
          timeOff: newTimeOff,
          availabilityUpdatedAt: serverTimestamp()
        },
        { merge: true }
      )
      setSaving(false)
    } catch (error) {
      console.error('Error saving:', error)
      setSaving(false)
      toast.error('Failed to save. Try again.')
    }
  }

  // Format date for display
  function formatDate(isoDate) {
    if (!isoDate) return ''
    const [year, month, day] = isoDate.split('-')
    return `${month}/${day}/${year}`
  }

  if (loading) {
    return (
      <main className="employees-page">
        <div className="empty-state">
          <p>Loading availability... <Loader2 size={16} className="spin" aria-hidden /></p>
        </div>
      </main>
    )
  }

  if (!employee) return null

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
          <div className="employee-avatar large">
            {employee.name[0].toUpperCase()}
          </div>
          <div>
            <h2 className="page-title no-margin">{employee.name}</h2>
            <p className="page-subtitle">{employee.role}</p>
          </div>
          {saving && <span className="saving-badge">Saving...</span>}
        </div>
      </div>

      {/* Weekly Availability */}
      <div className="availability-section">
        <h3 className="section-title">Weekly Availability</h3>
        <p className="section-subtitle">Tap a day to mark unavailable. Adjust hours as needed.</p>
        
        <div className="day-list">
          {DAYS.map(day => {
            const dayData = availability[day.key]
            return (
              <div 
                key={day.key} 
                className={`day-row ${dayData.available ? 'available' : 'unavailable'}`}
              >
                <button 
                  className="day-toggle"
                  onClick={() => toggleDay(day.key)}
                  aria-label={`Toggle ${day.label}`}
                >
                  <span className="day-name">{day.label}</span>
                  <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {dayData.available ? (
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
                
                {dayData.available && (
                  <div className="time-inputs">
                    <input
                      type="time"
                      className="time-input"
                      value={dayData.start}
                      onChange={(e) => updateTime(day.key, 'start', e.target.value)}
                    />
                    <span className="time-arrow"><ArrowRight size={16} aria-hidden /></span>
                    <input
                      type="time"
                      className="time-input"
                      value={dayData.end}
                      onChange={(e) => updateTime(day.key, 'end', e.target.value)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Time Off Section */}
      <div className="availability-section">
        <h3 className="section-title">Time Off Requests</h3>
        <p className="section-subtitle">Specific dates this person can't work.</p>
        
        <div className="add-employee-card timeoff-form">
          <div className="time-off-row">
            <div className="time-off-field">
              <label className="auth-label small">Start Date</label>
              <input
                type="date"
                className="input"
                value={newTimeOffStart}
                onChange={(e) => setNewTimeOffStart(e.target.value)}
              />
            </div>
            <div className="time-off-field">
              <label className="auth-label small">End Date</label>
              <input
                type="date"
                className="input"
                value={newTimeOffEnd}
                onChange={(e) => setNewTimeOffEnd(e.target.value)}
              />
            </div>
            <div className="time-off-field">
              <label className="auth-label small">Reason (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="Vacation, sick, etc."
                value={newTimeOffReason}
                onChange={(e) => setNewTimeOffReason(e.target.value)}
              />
            </div>
            <button className="add-button time-off-add" onClick={addTimeOff}>
              Add
            </button>
          </div>
        </div>

        <div className="timeoff-list">
          {timeOffList.length === 0 ? (
            <div className="empty-state small">
              <p>No time off requests yet.</p>
            </div>
          ) : (
            timeOffList.map(timeOff => (
              <div key={timeOff.id} className="timeoff-card">
                <div className="timeoff-info">
                  <p className="timeoff-dates" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Palmtree size={20} aria-hidden />
                    <span>{formatDate(timeOff.start)}</span>
                    <ArrowRight size={16} aria-hidden />
                    <span>{formatDate(timeOff.end)}</span>
                  </p>
                  <p className="timeoff-reason">{timeOff.reason}</p>
                </div>
                <button 
                  className="remove-button"
                  onClick={() => removeTimeOff(timeOff.id)}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}

export default Availability