import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { ArrowLeft, SlidersHorizontal, Plus, Users, Sparkles, BookOpen, Settings as SettingsIcon, ArrowRight, Link2, Copy, Check, X } from 'lucide-react'
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

function Employees() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const { t } = useI18n()

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
      toast.info(t('toastEnterName'))
      return
    }
    if (!role) {
      toast.info(t('toastSelectRole'))
      return
    }
    const hrs = Number(targetHours)
    if (isNaN(hrs) || hrs < 0 || hrs > 80) {
      toast.info(t('toastTargetHoursRange'))
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
      toast.success(`${t('addedPrefix')} ${trimmed}`)
    } catch (err) {
      console.error(err)
      toast.error(t('toastFailedAdd'))
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
      employeeRole: emp.role,
      allowEmployeeFullView: userData?.allowEmployeeFullView === true,
      allowEmployeeAvailabilityUpdates: userData?.allowEmployeeAvailabilityUpdates !== false,
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
    if (!window.confirm(`${t('confirmRemovePrefix')} ${empName}?`)) return
    try {
      await deleteDoc(doc(db, 'employees', id))
      toast.success(`${t('removedPrefix')} ${empName}`)
    } catch (err) {
      console.error(err)
      toast.error(t('toastFailedRemove'))
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
        <span>{t('backToDashboard')}</span>
      </button>

      <PageHero
        eyebrow={t('employeesEyebrow')}
        title={t('employeesTitle')}
        subtitle={t('employeesSubtitle')}
      >
        <div className="page-hero-actions">
          <button 
            className="landing-cta-primary"
            onClick={() => navigate('/schedule')}
          >
            <Sparkles size={16} />
            <span>{t('generateSchedule')}</span>
          </button>
          <button 
            className="settings-button"
            onClick={() => navigate('/schedules')}
          >
            <BookOpen size={16} />
            <span>{t('mySchedules')}</span>
          </button>
          <button 
            className="settings-button"
            onClick={() => navigate('/settings')}
          >
            <SlidersHorizontal size={16} />
            <span>{t('workspace')}</span>
          </button>
        </div>
      </PageHero>

      <Section 
        title={t('employeeAddTitle')}
        subtitle={t('employeeAddSubtitle')}
        icon={Plus}
      >
        {rolesList.length === 0 ? (
          <div className="empty-inline">
            <p>{t('employeeNeedRoles')}</p>
            <button 
              className="add-button"
              onClick={() => navigate('/settings')}
            >
              <SettingsIcon size={14} />
              <span>{t('goToSettings')}</span>
            </button>
          </div>
        ) : (
          <div className="employee-form">
            <div className="employee-form-row">
              <div className="employee-form-field">
                <label className="form-label">{t('name')}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={t('employeeNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addEmployee()}
                />
              </div>
              <div className="employee-form-field">
                <label className="form-label">{t('role')}</label>
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
                <label className="form-label">{t('targetHoursWeek')}</label>
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
              <span>{adding ? t('adding') : t('addToTeam')}</span>
            </button>
          </div>
        )}
      </Section>

      <Section 
        title={employees.length === 0 ? t('noTeamYet') : `${employees.length} ${employees.length === 1 ? t('person') : t('people')} ${t('teamCountTitle')}`}
        subtitle={employees.length === 0 ? t('employeesEmptySubtitle') : t('employeesListSubtitle')}
        icon={Users}
      >
        {loading ? (
          <div className="empty-state">
            <p>{t('loadingTeam')}</p>
          </div>
        ) : employees.length === 0 ? (
          <div className="empty-state app-empty">
            <Users size={36} />
            <p>{t('employeesNobody')}</p>
          </div>
        ) : (
          <div className="team-grid">
            {employees.map((emp, i) => (
              <Motion.div
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
                  <span className="team-card-meta">{t('targetShort')}: {emp.targetHours ?? 0}{t('hoursPerWeekShort')}</span>
                  <div className="team-card-bottom-right">
                    <button
                      className="employee-invite-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        generateInvite(emp)
                      }}
                      title={t('generateInviteLink')}
                    >
                      <Link2 size={12} />
                      <span>{t('invite')}</span>
                    </button>
                    <span className="team-card-arrow">
                      {t('availability')} <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              </Motion.div>
            ))}
          </div>
        )}
      </Section>
      {inviteModal && (
        <div className="modal-backdrop" onClick={() => setInviteModal(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="shift-modal-header">
              <h3 className="modal-title">{t('inviteModalTitle')} {inviteModal.employeeName}</h3>
              <button className="modal-close-btn" onClick={() => setInviteModal(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="shift-modal-day">
              {t('inviteModalCopyBefore')} {inviteModal.employeeName}. {t('inviteModalCopyAfter')}
            </p>
            <div className="invite-link-box">
              <span className="invite-link-text">{inviteModal.link}</span>
              <button className="invite-copy-btn" onClick={copyInviteLink}>
                {inviteModal.copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{inviteModal.copied ? t('copied') : t('copy')}</span>
              </button>
            </div>
            <p className="invite-link-note">
              {t('inviteLinkNote')}
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

export default Employees
