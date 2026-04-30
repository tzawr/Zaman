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

function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useAuth()
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
          <p>Loading dashboard...</p>
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
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${fmt(monday)} — ${fmt(sunday)}`
  }

  function formatTime(timestamp) {
    if (!timestamp) return ''
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
<main className="app-page dashboard-layout">
  <PageHero
  eyebrow={`${getGreeting()}, ${userData?.displayName || 'Manager'}`}
  title={<>Welcome to <span className="landing-gradient-text">Hengam</span></>}
  subtitle="Your scheduling command center."
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
              {employees.length === 1 ? 'Team member' : 'Team members'}
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
              {roleCount === 1 ? 'Role' : 'Roles'} defined
            </div>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Calendar size={20} />
          </div>
          <div>
            <div className="dashboard-stat-value">{openDays}</div>
            <div className="dashboard-stat-label">Open days / week</div>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="dashboard-stat-icon">
            <Clock size={20} />
          </div>
          <div>
            <div className="dashboard-stat-value">{totalTargetHours}</div>
            <div className="dashboard-stat-label">Total target hrs</div>
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
          <h2 className="dashboard-generate-title">Generate schedule</h2>
          <p className="dashboard-generate-desc">Build this week's schedule with AI — in seconds</p>
        </div>
        <div className="dashboard-generate-cta">
          <span>Get started</span>
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
        <h2 className="dashboard-section-title">Quick actions</h2>
        <div className="dashboard-grid">
          <DashCard
            icon={Users}
            title="Your team"
            description={`${employees.length} ${employees.length === 1 ? 'person' : 'people'} on the team`}
            onClick={() => navigate('/employees')}
          />
          <DashCard
            icon={BookOpen}
            title="Schedule history"
            description={`${recentSchedules.length} recent ${recentSchedules.length === 1 ? 'schedule' : 'schedules'}`}
            onClick={() => navigate('/schedules')}
          />
          <DashCard
            icon={SlidersHorizontal}
            title="Workspace"
            description="Hours, roles, coverage & rules"
            onClick={() => navigate('/settings')}
          />
          <DashCard
            icon={Link2}
            title="Invite team members"
            description="Send each person a link to join"
            onClick={() => navigate('/invite')}
          />
          {userData?.accountType === 'employee' && (
            <DashCard
              icon={CalendarDays}
              title="My Schedule"
              description="Go back to your personal shifts"
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
            <h2 className="dashboard-section-title">Recent schedules</h2>
            <button 
              className="dashboard-see-all"
              onClick={() => navigate('/schedules')}
            >
              See all <ArrowRight size={14} />
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
                    Generated {formatTime(sched.createdAt)}
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
            <h2 className="dashboard-section-title">Your team</h2>
            <button 
              className="dashboard-see-all"
              onClick={() => navigate('/employees')}
            >
              Manage <ArrowRight size={14} />
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
          <h3 className="dashboard-empty-title">Add your first team member</h3>
          <p className="dashboard-empty-desc">
            Start by adding the people you schedule. It takes 2 minutes.
          </p>
          <button 
            className="landing-cta-primary"
            onClick={() => navigate('/employees')}
          >
            <span>Add team members</span>
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

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default Dashboard
