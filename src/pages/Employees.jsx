import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, Users, Sparkles, BookOpen, Settings as SettingsIcon, ArrowRight, Link2, Copy, Check, X } from 'lucide-react'
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

function Employees() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()

  const [employees, setEmployees] = useState([])
  const [userData, setUserData] = useState(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [targetHours, setTargetHours] = useState(30)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [inviteModal, setInviteModal] = useState(null) // { employeeId, employeeName, link, copied }

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  useEffect(() => {
    if (!currentUser) return
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        if (!data.onboarded) {
          navigate('/onboarding')
          return
        }
        setUserData(data)
        if (data.roles && data.roles.length > 0 && !role) {
          setRole(data.roles[0].name)
        }
      }
    })
    return () => unsub()
  }, [currentUser, navigate, role])

  useEffect(() => {
    if (!currentUser) return
    const q = query(collection(db, 'employees'), where('userId', '==', currentUser.uid))
    const unsub = onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return () => unsub()
  }, [currentUser])

  async function addEmployee() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.info('Please enter a name')
      return
    }
    if (!role) {
      toast.info('Please select a role')
      return
    }
    const hrs = Number(targetHours)
    if (isNaN(hrs) || hrs < 0 || hrs > 80) {
      toast.info('Target hours must be between 0 and 80')
      return
    }
    try {
      setAdding(true)
      await addDoc(collection(db, 'employees'), {
        userId: currentUser.uid,
        name: trimmed,
        role,
        targetHours: hrs,
        availability: {},
        timeOff: [],
        createdAt: serverTimestamp()
      })
      setName('')
      toast.success(`Added ${trimmed}`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to add. Try again.')
    } finally {
      setAdding(false)
    }
  }

  async function generateInvite(emp) {
    const token = crypto.randomUUID()
    await setDoc(doc(db, 'invites', token), {
      managerId: currentUser.uid,
      employeeId: emp.id,
      employeeName: emp.name,
      createdAt: serverTimestamp(),
      used: false,
    })
    const link = `${window.location.origin}/invite/${token}`
    setInviteModal({ employeeId: emp.id, employeeName: emp.name, link, copied: false })
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteModal.link)
    setInviteModal(m => ({ ...m, copied: true }))
    setTimeout(() => setInviteModal(m => m ? { ...m, copied: false } : m), 2000)
  }

  async function removeEmployee(id, empName) {
    if (!window.confirm(`Remove ${empName}?`)) return
    try {
      await deleteDoc(doc(db, 'employees', id))
      toast.success(`Removed ${empName}`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to remove.')
    }
  }

  const rolesList = userData?.roles || []

  return (
    <main className="app-page">
      <button 
        className="app-back-link"
        onClick={() => navigate('/dashboard')}
      >
        <ArrowLeft size={14} />
        <span>Back to dashboard</span>
      </button>

      <PageHero
        eyebrow="Team"
        title="Your team"
        subtitle="The people you schedule. Click anyone to set their availability and time off."
      >
        <div className="page-hero-actions">
          <button 
            className="landing-cta-primary"
            onClick={() => navigate('/schedule')}
          >
            <Sparkles size={16} />
            <span>Generate schedule</span>
          </button>
          <button 
            className="settings-button"
            onClick={() => navigate('/schedules')}
          >
            <BookOpen size={16} />
            <span>My schedules</span>
          </button>
          <button 
            className="settings-button"
            onClick={() => navigate('/settings')}
          >
            <SettingsIcon size={16} />
            <span>Settings</span>
          </button>
        </div>
      </PageHero>

      <Section 
        title="Add a team member" 
        subtitle="Use nicknames to keep things private."
        icon={Plus}
      >
        {rolesList.length === 0 ? (
          <div className="empty-inline">
            <p>You need to set up roles first.</p>
            <button 
              className="add-button"
              onClick={() => navigate('/settings')}
            >
              <SettingsIcon size={14} />
              <span>Go to settings</span>
            </button>
          </div>
        ) : (
          <div className="employee-form">
            <div className="employee-form-row">
              <div className="employee-form-field">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Sam"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addEmployee()}
                />
              </div>
              <div className="employee-form-field">
                <label className="form-label">Role</label>
                <select 
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  {rolesList.map(r => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="employee-form-field employee-form-field-small">
                <label className="form-label">Target hrs/week</label>
                <input
                  type="number"
                  min="0"
                  max="80"
                  className="input"
                  value={targetHours}
                  onChange={(e) => setTargetHours(e.target.value)}
                />
              </div>
            </div>
            <button 
              className="add-button employee-add-btn"
              onClick={addEmployee}
              disabled={adding}
            >
              <Plus size={16} />
              <span>{adding ? 'Adding...' : 'Add to team'}</span>
            </button>
          </div>
        )}
      </Section>

      <Section 
        title={employees.length === 0 ? 'No team members yet' : `${employees.length} ${employees.length === 1 ? 'person' : 'people'} on your team`}
        subtitle={employees.length === 0 ? 'Add your first person above to get started.' : 'Click a card to manage their availability and time off.'}
        icon={Users}
      >
        {loading ? (
          <div className="empty-state">
            <p>Loading team...</p>
          </div>
        ) : employees.length === 0 ? (
          <div className="empty-state app-empty">
            <Users size={36} />
            <p>Nobody here yet. Add your first team member above.</p>
          </div>
        ) : (
          <div className="team-grid">
            {employees.map((emp, i) => (
              <motion.div
                key={emp.id}
                className="team-card"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                onClick={() => navigate(`/employees/${emp.id}/availability`)}
              >
                <div className="team-card-top">
                  <div className="employee-avatar">{emp.name[0]?.toUpperCase()}</div>
                  <div className="team-card-info">
                    <div className="team-card-name">{emp.name}</div>
                    <div className="team-card-role">{emp.role}</div>
                  </div>
                  <button
                    className="team-card-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeEmployee(emp.id, emp.name)
                    }}
                    aria-label={`Remove ${emp.name}`}
                  >
                    ×
                  </button>
                </div>
                <div className="team-card-bottom">
                  <span className="team-card-meta">Target: {emp.targetHours ?? 0}h/wk</span>
                  <div className="team-card-bottom-right">
                    <button
                      className="employee-invite-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        generateInvite(emp)
                      }}
                      title="Generate invite link"
                    >
                      <Link2 size={12} />
                      <span>Invite</span>
                    </button>
                    <span className="team-card-arrow">
                      Availability <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Section>
      {inviteModal && (
        <div className="modal-backdrop" onClick={() => setInviteModal(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="shift-modal-header">
              <h3 className="modal-title">Invite {inviteModal.employeeName}</h3>
              <button className="modal-close-btn" onClick={() => setInviteModal(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="shift-modal-day">
              Share this link with {inviteModal.employeeName}. They'll create a free account and see only their own shifts.
            </p>
            <div className="invite-link-box">
              <span className="invite-link-text">{inviteModal.link}</span>
              <button className="invite-copy-btn" onClick={copyInviteLink}>
                {inviteModal.copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{inviteModal.copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            <p className="invite-link-note">
              This link can only be used once. Generate a new one if needed.
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

export default Employees