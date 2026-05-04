import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Users,
  Calendar,
  SlidersHorizontal,
  Sparkles,
  BookOpen,
  ArrowRight,
  Clock,
  Target,
  Link2,
  CalendarDays
} from 'lucide-react'
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  orderBy,
  limit
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import { useI18n } from '../i18n'

function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAuth()
  const { t, language } = useI18n()
  const managerMode = !!location.state?.managerMode
  void motion
  
  const [userData, setUserData] = useState(null)
  const [employees, setEmployees] = useState([])
  const [recentSchedules, setRecentSchedules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
    }
  }, [currentUser, navigate])

  useEffect(() => {
    if (!currentUser) return
    const unsubscribe = onSnapshot(doc(db, 'users', currentUser.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data()
        if (!data.onboarded) {
          navigate('/onboarding')
          return
        }
        // Only redirect employees if they didn't intentionally open manager mode
        if (data.accountType === 'employee' && !managerMode) {
          navigate('/my-schedule')
          return
        }
        setUserData(data)
        setLoading(false)
      } else {
        navigate('/onboarding')
      }
    })
    return () => unsubscribe()
  }, [currentUser, managerMode, navigate])

  useEffect(() => {
    if (!currentUser) return
    const q = query(
      collection(db, 'employees'),
      where('userId', '==', currentUser.uid)
    )
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEmployees(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsubscribe()
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    const q = query(
      collection(db, 'schedules'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(3)
    )
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRecentSchedules(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
    }, () => {})
    return () => unsubscribe()
  }, [currentUser])

  if (loading) {
    return (
      <main className="dashboard-page">
        <div className="empty-state">
          <p>{t('loadingDashboard')}</p>
        </div>
      </main>
    )
  }

  const totalTargetHours = employees.reduce((sum, e) => sum + (e.targetHours || 0), 0)
  const roleCount = userData?.roles?.length || 0
  const openDays = userData?.operatingHours 
    ? Object.values(userData.operatingHours).filter(d => d.open).length 
    : 0

  function formatWeekRange(mondayStr) {
    if (!mondayStr) return ''
    const monday = new Date(mondayStr + 'T12:00:00')
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const fmt = (d) => d.toLocaleDateString(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' })
    return `${fmt(monday)} — ${fmt(sunday)}`
  }

  function formatTime(timestamp) {
    if (!timestamp) return ''
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' })
  }

  return (
<main className="app-page dashboard-layout">
  <PageHero
  eyebrow={`${getGreeting(t)}, ${userData?.displayName || t('manager')}`}
  title={<>{t('welcomeTo')} <span className="landing-gradient-text">{t('brandName')}</span></>}
  subtitle={t('dashboardSubtitle')}
>
</PageHero>

      {/* Stats row */}
      <motion.div 
        className="dashboard-stats"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Users size={20} />
          </div>
          <div>
            <div className="dashboard-stat-value">{employees.length}</div>
            <div className="dashboard-stat-label">
              {employees.length === 1 ? t('teamMember') : t('teamMembers')}
            </div>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Target size={20} />
          </div>
          <div>
            <div className="dashboard-stat-value">{roleCount}</div>
            <div className="dashboard-stat-label">
              {roleCount === 1 ? t('roleDefined') : t('rolesDefined')}
            </div>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Calendar size={20} />
          </div>
          <div>
            <div className="dashboard-stat-value">{openDays}</div>
            <div className="dashboard-stat-label">{t('openDaysWeek')}</div>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Clock size={20} />
          </div>
          <div>
            <div className="dashboard-stat-value">{totalTargetHours}</div>
            <div className="dashboard-stat-label">{t('totalTargetHours')}</div>
          </div>
        </div>
      </motion.div>

      {/* Generate schedule — hero CTA */}
      <motion.div
        className="dashboard-generate-hero"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        onClick={() => navigate('/schedule')}
      >
        <div className="dashboard-generate-orb" aria-hidden />
        <div className="dashboard-generate-orb dashboard-generate-orb-2" aria-hidden />
        <div className="dashboard-generate-icon">
          <Sparkles size={34} />
        </div>
        <div className="dashboard-generate-content">
          <h2 className="dashboard-generate-title">{t('generateSchedule')}</h2>
          <p className="dashboard-generate-desc">{t('dashboardGenerateDesc')}</p>
        </div>
        <div className="dashboard-generate-cta">
          <span>{t('getStartedAction')}</span>
          <ArrowRight size={18} />
        </div>
      </motion.div>

      {/* Quick actions grid */}
      <motion.div
        className="dashboard-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.22 }}
      >
        <h2 className="dashboard-section-title">{t('dashboardQuickActions')}</h2>
        <div className="dashboard-grid">
          <DashCard
            icon={Users}
            title={t('yourTeam')}
            description={`${employees.length} ${employees.length === 1 ? t('person') : t('people')} ${t('dashboardTeamDescription')}`}
            onClick={() => navigate('/employees')}
          />
          <DashCard
            icon={BookOpen}
            title={t('scheduleHistory')}
            description={`${recentSchedules.length} ${t('dashboardRecentPrefix')} ${recentSchedules.length === 1 ? t('schedule') : t('schedules')}`}
            onClick={() => navigate('/schedules')}
          />
          <DashCard
            icon={SlidersHorizontal}
            title={t('workspace')}
            description={t('dashboardWorkspaceDesc')}
            onClick={() => navigate('/settings')}
          />
          <DashCard
            icon={Link2}
            title={t('inviteTeam')}
            description={t('dashboardInviteDesc')}
            onClick={() => navigate('/invite')}
          />
          {userData?.accountType === 'employee' && (
            <DashCard
              icon={CalendarDays}
              title={t('mySchedule')}
              description={t('dashboardMyScheduleDesc')}
              onClick={() => navigate('/my-schedule')}
              highlighted
            />
          )}
        </div>
      </motion.div>

      {/* Recent schedules */}
      {recentSchedules.length > 0 && (
        <motion.div
          className="dashboard-section"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="dashboard-section-header">
            <h2 className="dashboard-section-title">{t('recentSchedules')}</h2>
            <button 
              className="dashboard-see-all"
              onClick={() => navigate('/schedules')}
            >
              {t('seeAll')} <ArrowRight size={14} />
            </button>
          </div>
          <div className="dashboard-schedules">
            {recentSchedules.map(sched => (
              <div 
                key={sched.id} 
                className="dashboard-schedule-item"
                onClick={() => navigate('/schedules')}
              >
                <div className="dashboard-schedule-icon">
                  <Calendar size={18} />
                </div>
                <div className="dashboard-schedule-info">
                  <div className="dashboard-schedule-week">
                    {formatWeekRange(sched.weekStart)}
                  </div>
                  <div className="dashboard-schedule-meta">
                    {t('generated')} {formatTime(sched.createdAt)}
                  </div>
                </div>
                <ArrowRight size={16} className="dashboard-schedule-arrow" />
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Team preview */}
      {employees.length > 0 && (
        <motion.div
          className="dashboard-section"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
        >
          <div className="dashboard-section-header">
            <h2 className="dashboard-section-title">{t('yourTeam')}</h2>
            <button 
              className="dashboard-see-all"
              onClick={() => navigate('/employees')}
            >
              {t('manage')} <ArrowRight size={14} />
            </button>
          </div>
          <div className="dashboard-team-grid">
            {employees.slice(0, 6).map(emp => (
              <div 
                key={emp.id} 
                className="dashboard-team-member"
                onClick={() => navigate(`/employees/${emp.id}/availability`)}
              >
                <div className="employee-avatar">{emp.name[0].toUpperCase()}</div>
                <div className="dashboard-team-info">
                  <div className="dashboard-team-name">{emp.name}</div>
                  <div className="dashboard-team-role">
                    {emp.role}
                    {emp.targetHours !== undefined && ` • ${emp.targetHours}h`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Empty state if no employees */}
      {employees.length === 0 && (
        <motion.div
          className="dashboard-empty"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="dashboard-empty-icon">
            <Users size={32} />
          </div>
          <h3 className="dashboard-empty-title">{t('addFirstTeamMember')}</h3>
          <p className="dashboard-empty-desc">
            {t('addFirstTeamDesc')}
          </p>
          <button 
            className="landing-cta-primary"
            onClick={() => navigate('/employees')}
          >
            <span>{t('addTeamMembers')}</span>
            <ArrowRight size={16} />
          </button>
        </motion.div>
      )}
    </main>
  )
}

function DashCard({ icon: Icon, title, description, onClick, highlighted }) {
  void Icon
  return (
    <div 
      className={`dashboard-card ${highlighted ? 'dashboard-card-highlighted' : ''}`}
      onClick={onClick}
    >
      <div className="dashboard-card-icon">
        <Icon size={22} />
      </div>
      <div className="dashboard-card-content">
        <h3 className="dashboard-card-title">{title}</h3>
        <p className="dashboard-card-desc">{description}</p>
      </div>
      <ArrowRight size={18} className="dashboard-card-arrow" />
    </div>
  )
}

function getGreeting(t) {
  const hour = new Date().getHours()
  if (hour < 12) return t('goodMorning')
  if (hour < 18) return t('goodAfternoon')
  return t('goodEvening')
}

export default Dashboard
