import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Clock, Calendar, Users, LayoutDashboard, Palmtree } from 'lucide-react'
import { doc, getDoc, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import ScheduleTable from '../components/ScheduleTable'

const DAYS = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
]

function formatTime(time24) {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${displayH}${period.toLowerCase()}` : `${displayH}:${String(m).padStart(2, '0')}${period.toLowerCase()}`
}

function formatWeekRange(weekStart) {
  if (!weekStart) return ''
  const start = new Date(weekStart + 'T12:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
}

function formatDayDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function MySchedule() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  const [userDoc, setUserDoc] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [weekIndex, setWeekIndex] = useState(0)
  const [viewMode, setViewMode] = useState('mine') // 'mine' | 'full'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentUser) { navigate('/signin'); return }
    getDoc(doc(db, 'users', currentUser.uid)).then(snap => {
      if (!snap.exists()) {
        setError('Account not set up correctly. Contact your manager.')
        setLoading(false)
        return
      }
      const data = snap.data()
      if (data.accountType !== 'employee') { navigate('/dashboard'); return }
      setUserDoc(data)
    }).catch(() => {
      setError('Failed to load your account. Try refreshing.')
      setLoading(false)
    })
  }, [currentUser, navigate])

  // Load schedules
  useEffect(() => {
    if (!userDoc?.managerId) return
    const q = query(
      collection(db, 'schedules'),
      where('userId', '==', userDoc.managerId),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, snap => {
      setSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => {
      setError('Failed to load schedules.')
      setLoading(false)
    })
    return () => unsub()
  }, [userDoc])

  if (loading) {
    return (
      <main className="app-page app-page-narrow">
        <div className="empty-state"><p>Loading your schedule...</p></div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="app-page app-page-narrow">
        <div className="empty-state"><p>{error}</p></div>
      </main>
    )
  }

  const employeeName = userDoc?.employeeName || ''
  const canSeeFullSchedule = userDoc?.allowEmployeeFullView === true
  const totalWeeks = schedules.length
  const currentSchedule = schedules[weekIndex] || null

  // My shifts for the current week
  const myDays = DAYS.map(day => {
    const dayData = currentSchedule?.data?.days?.[day.key] || { shifts: [], date: '' }
    const myShifts = (dayData.shifts || []).filter(s => s.employee === employeeName)
    return { ...day, date: dayData.date, shifts: myShifts }
  })
  const totalHours = myDays.reduce((sum, d) => sum + d.shifts.reduce((s, sh) => s + (Number(sh.hours) || 0), 0), 0)
  const workingDays = myDays.filter(d => d.shifts.length > 0).length

  const weekNav = (
    <div className="my-schedule-week-nav">
      <button
        className="my-schedule-week-btn"
        onClick={() => setWeekIndex(i => i + 1)}
        disabled={weekIndex >= totalWeeks - 1}
        aria-label="Previous week"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="my-schedule-week-label">
        {formatWeekRange(currentSchedule?.weekStart)}
      </span>
      <button
        className="my-schedule-week-btn"
        onClick={() => setWeekIndex(i => i - 1)}
        disabled={weekIndex <= 0}
        aria-label="Next week"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )

  return (
    <main className="app-page">
      <PageHero
        eyebrow="My Schedule"
        title={`Hi, ${employeeName}`}
        subtitle="Your shifts, updated in real time by your manager."
      >
        <div className="page-hero-actions">
          <button
            className="settings-button"
            onClick={() => navigate('/my-availability')}
          >
            <Palmtree size={15} />
            <span>My availability</span>
          </button>
          <button
            className="settings-button"
            onClick={() => navigate('/dashboard', { state: { managerMode: true } })}
          >
            <LayoutDashboard size={15} />
            <span>Manager Dashboard</span>
          </button>
        </div>
        {canSeeFullSchedule && (
          <div className="my-schedule-view-toggle">
            <button
              className={`my-schedule-toggle-btn ${viewMode === 'mine' ? 'active' : ''}`}
              onClick={() => setViewMode('mine')}
            >
              <Clock size={14} />
              <span>My shifts</span>
            </button>
            <button
              className={`my-schedule-toggle-btn ${viewMode === 'full' ? 'active' : ''}`}
              onClick={() => setViewMode('full')}
            >
              <Users size={14} />
              <span>Full schedule</span>
            </button>
          </div>
        )}
      </PageHero>

      {totalWeeks === 0 ? (
        <Section title="This week" icon={Calendar} delay={0.05}>
          <div className="my-schedule-no-schedules">
            <Calendar size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>No schedule published yet. Check back soon.</p>
          </div>
        </Section>
      ) : viewMode === 'full' && canSeeFullSchedule ? (
        <Section title="Full team schedule" icon={Users} delay={0.05}>
          {weekNav}
          {currentSchedule?.data && (
            <ScheduleTable data={currentSchedule.data} />
          )}
        </Section>
      ) : (
        <Section title="Your shifts this week" icon={Calendar} delay={0.05}>
          {weekNav}

          {workingDays > 0 && (
            <div className="my-schedule-stats">
              <span className="my-schedule-stat">
                <Clock size={13} />
                {Math.round(totalHours * 10) / 10}h this week
              </span>
              <span className="my-schedule-stat">
                {workingDays} {workingDays === 1 ? 'shift' : 'shifts'}
              </span>
            </div>
          )}

          <div className="my-schedule-grid">
            {myDays.map((day, i) => (
              <motion.div
                key={day.key}
                className={`my-schedule-day ${day.shifts.length > 0 ? 'has-shift' : ''}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                <div className="my-schedule-day-label">{day.label}</div>
                {day.date && (
                  <div className="my-schedule-day-date">{formatDayDate(day.date)}</div>
                )}
                {day.shifts.length > 0 ? (
                  day.shifts.map((shift, j) => (
                    <div key={j}>
                      <div className="my-schedule-shift">
                        <Clock size={11} style={{ marginRight: 4, flexShrink: 0 }} />
                        {formatTime(shift.start)} – {formatTime(shift.end)}
                      </div>
                      {shift.role && (
                        <div className="my-schedule-shift-role">{shift.role}</div>
                      )}
                      <div className="my-schedule-shift-hours">{shift.hours}h</div>
                    </div>
                  ))
                ) : (
                  <div className="my-schedule-day-off">Day off</div>
                )}
              </motion.div>
            ))}
          </div>
        </Section>
      )}
    </main>
  )
}

export default MySchedule
