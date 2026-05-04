import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Clock, Calendar, Users, LayoutDashboard, Palmtree } from 'lucide-react'
import { doc, getDoc, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import ScheduleTable from '../components/ScheduleTable'
import { useI18n } from '../i18n'

const DAYS = [
  { key: 'monday', labelKey: 'dayMonShort' },
  { key: 'tuesday', labelKey: 'dayTueShort' },
  { key: 'wednesday', labelKey: 'dayWedShort' },
  { key: 'thursday', labelKey: 'dayThuShort' },
  { key: 'friday', labelKey: 'dayFriShort' },
  { key: 'saturday', labelKey: 'daySatShort' },
  { key: 'sunday', labelKey: 'daySunShort' },
]

function formatTime(time24, language = 'en') {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  if (language === 'fa') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${displayH}${period.toLowerCase()}` : `${displayH}:${String(m).padStart(2, '0')}${period.toLowerCase()}`
}

function formatWeekRange(weekStart, language) {
  if (!weekStart) return ''
  const start = new Date(weekStart + 'T12:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts = { month: 'short', day: 'numeric' }
  const locale = language === 'fa' ? 'fa-IR-u-nu-latn' : 'en-US'
  return `${start.toLocaleDateString(locale, opts)} – ${end.toLocaleDateString(locale, { ...opts, year: 'numeric' })}`
}

function formatDayDate(dateStr, language) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(language === 'fa' ? 'fa-IR-u-nu-latn' : 'en-US', { month: 'short', day: 'numeric' })
}

function MySchedule() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { t, language } = useI18n()

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
        setError(t('myScheduleLoadErrorSetup'))
        setLoading(false)
        return
      }
      const data = snap.data()
      if (data.accountType !== 'employee') { navigate('/dashboard'); return }
      setUserDoc(data)
    }).catch(() => {
      setError(t('myScheduleLoadErrorAccount'))
      setLoading(false)
    })
  }, [currentUser, navigate, t])

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
      setError(t('myScheduleLoadErrorSchedules'))
      setLoading(false)
    })
    return () => unsub()
  }, [userDoc, t])

  if (loading) {
    return (
      <main className="app-page app-page-narrow">
        <div className="empty-state"><p>{t('loadingYourSchedule')}</p></div>
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
        aria-label={t('previousWeek')}
      >
        <ChevronLeft size={16} />
      </button>
      <span className="my-schedule-week-label">
        {formatWeekRange(currentSchedule?.weekStart, language)}
      </span>
      <button
        className="my-schedule-week-btn"
        onClick={() => setWeekIndex(i => i - 1)}
        disabled={weekIndex <= 0}
        aria-label={t('nextWeek')}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )

  return (
    <main className="app-page">
      <PageHero
        eyebrow={t('myScheduleEyebrow')}
        title={`${t('hiPrefix')}, ${employeeName}`}
        subtitle={t('myScheduleSubtitle')}
      >
        <div className="page-hero-actions">
          <button
            className="settings-button"
            onClick={() => navigate('/my-availability')}
          >
            <Palmtree size={15} />
            <span>{t('myAvailability')}</span>
          </button>
          <button
            className="settings-button"
            onClick={() => navigate('/dashboard', { state: { managerMode: true } })}
          >
            <LayoutDashboard size={15} />
            <span>{t('managerDashboard')}</span>
          </button>
        </div>
        {canSeeFullSchedule && (
          <div className="my-schedule-view-toggle">
            <button
              className={`my-schedule-toggle-btn ${viewMode === 'mine' ? 'active' : ''}`}
              onClick={() => setViewMode('mine')}
            >
              <Clock size={14} />
              <span>{t('myShifts')}</span>
            </button>
            <button
              className={`my-schedule-toggle-btn ${viewMode === 'full' ? 'active' : ''}`}
              onClick={() => setViewMode('full')}
            >
              <Users size={14} />
              <span>{t('fullSchedule')}</span>
            </button>
          </div>
        )}
      </PageHero>

      {totalWeeks === 0 ? (
        <Section title={t('thisWeek')} icon={Calendar} delay={0.05}>
          <div className="my-schedule-no-schedules">
            <Calendar size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>{t('noSchedulePublished')}</p>
          </div>
        </Section>
      ) : viewMode === 'full' && canSeeFullSchedule ? (
        <Section title={t('fullTeamSchedule')} icon={Users} delay={0.05}>
          {weekNav}
          {currentSchedule?.data && (
            <ScheduleTable data={currentSchedule.data} />
          )}
        </Section>
      ) : (
        <Section title={t('yourShiftsThisWeek')} icon={Calendar} delay={0.05}>
          {weekNav}

          {workingDays > 0 && (
            <div className="my-schedule-stats">
              <span className="my-schedule-stat">
                <Clock size={13} />
                {Math.round(totalHours * 10) / 10}{t('hoursThisWeek')}
              </span>
              <span className="my-schedule-stat">
                {workingDays} {workingDays === 1 ? t('shift') : t('shifts')}
              </span>
            </div>
          )}

          <div className="my-schedule-grid">
            {myDays.map((day, i) => (
              <Motion.div
                key={day.key}
                className={`my-schedule-day ${day.shifts.length > 0 ? 'has-shift' : ''}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                <div className="my-schedule-day-label">{t(day.labelKey)}</div>
                {day.date && (
                  <div className="my-schedule-day-date">{formatDayDate(day.date, language)}</div>
                )}
                {day.shifts.length > 0 ? (
                  day.shifts.map((shift, j) => (
                    <div key={j}>
                      <div className="my-schedule-shift">
                        <Clock size={11} style={{ marginRight: 4, flexShrink: 0 }} />
                        {formatTime(shift.start, language)} – {formatTime(shift.end, language)}
                      </div>
                      {shift.role && (
                        <div className="my-schedule-shift-role">{shift.role}</div>
                      )}
                      <div className="my-schedule-shift-hours">{shift.hours}h</div>
                    </div>
                  ))
                ) : (
                  <div className="my-schedule-day-off">{t('dayOff')}</div>
                )}
              </Motion.div>
            ))}
          </div>
        </Section>
      )}
    </main>
  )
}

export default MySchedule
