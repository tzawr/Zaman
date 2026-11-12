import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { ArrowLeft, SlidersHorizontal, Plus, Users, Sparkles, BookOpen, Settings as SettingsIcon, ArrowRight, Link2, Copy, Check, X, Pencil } from 'lucide-react'
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, setDoc, updateDoc, getDocs, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'
import InviteEmailForm from '../components/InviteEmailForm'
import { canAddEmployee, canInviteEmployees } from '../utils/tier'
import { useModalFocus } from '../utils/useModalFocus'

function EmployeeDialog({ onClose, labelledBy, children }) {
  const ref = useModalFocus(onClose)
  return (
    <div className="modal-card" ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={e => e.stopPropagation()}>
      {children}
    </div>
  )
}

function Employees() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const { t, tf } = useI18n()

  const [employees, setEmployees] = useState([])
  const [userData, setUserData] = useState(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [targetHours, setTargetHours] = useState(30)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [inviteModal, setInviteModal] = useState(null) // { employeeId, employeeName, link, copied }
  // Editing an existing person's name, role and weekly target (HQA-17).
  const [editing, setEditing] = useState(null) // { id, name, role, targetHours, originalName }
  const [savingEdit, setSavingEdit] = useState(false)

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
    // The scheduler identifies people by name, so two employees sharing one
    // would share their shifts and double up in the hours summary.
    if (employees.some(emp => emp.name?.trim().toLowerCase() === trimmed.toLowerCase())) {
      toast.info(tf('toastDuplicateName', { name: trimmed }))
      return
    }
    const hrs = Number(targetHours)
    if (isNaN(hrs) || hrs < 0 || hrs > 80) {
      toast.info(t('toastTargetHoursRange'))
      return
    }
    const gate = await canAddEmployee(currentUser.uid, employees.length)
    if (gate.blocked) {
      toast.info(gate.message)
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
    const gate = await canInviteEmployees(currentUser.uid)
    if (gate.blocked) {
      toast.info(gate.message)
      return
    }
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

  async function saveEmployeeDetails() {
    if (!editing) return
    const trimmed = editing.name.trim()
    if (!trimmed) { toast.info(t('toastEnterName')); return }
    if (!editing.role) { toast.info(t('toastSelectRole')); return }
    // Names identify people in schedules, so they must stay unique.
    if (employees.some(emp => emp.id !== editing.id && emp.name?.trim().toLowerCase() === trimmed.toLowerCase())) {
      toast.info(tf('toastDuplicateName', { name: trimmed }))
      return
    }
    const hrs = Number(editing.targetHours)
    if (editing.targetHours === '' || isNaN(hrs) || hrs < 0 || hrs > 80) { toast.info(t('toastTargetHoursRange')); return }
    try {
      setSavingEdit(true)
      await updateDoc(doc(db, 'employees', editing.id), { name: trimmed, role: editing.role, targetHours: hrs, detailsUpdatedAt: serverTimestamp() })
      // The employee's own portal shows a copy of their name and role.
      try {
        const portal = await getDocs(query(collection(db, 'users'), where('managerId', '==', currentUser.uid), where('accountType', '==', 'employee')))
        await Promise.all(portal.docs.filter(d => d.data().linkedEmployeeId === editing.id)
          .map(d => updateDoc(doc(db, 'users', d.id), { employeeName: trimmed, employeeRole: editing.role })))
      } catch {
        // The employee record is the source of truth; the portal copy is cosmetic.
      }
      toast.success(tf('employeeDetailsSaved', { name: trimmed }))
      setEditing(null)
    } catch (err) {
      console.error(err)
      toast.error(t('failedToSave'))
    } finally {
      setSavingEdit(false)
    }
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
                <label htmlFor="employees-name" className="form-label">{t('name')}</label>
                <input
                  id="employees-name"
                  type="text"
                  className="input"
                  placeholder={t('employeeNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addEmployee()}
                />
              </div>
              <div className="employee-form-field">
                <label htmlFor="employees-role" className="form-label">{t('role')}</label>
                <select id="employees-role" 
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
                <label htmlFor="employees-targetHoursWeek" className="form-label">{t('targetHoursWeek')}</label>
                <input
                  id="employees-targetHoursWeek"
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
                    aria-label={tf('removeEmployeeLabel', { name: emp.name })}
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
                    <button
                      type="button"
                      className="employee-invite-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ id: emp.id, name: emp.name || '', role: emp.role || rolesList[0]?.name || '', targetHours: String(emp.targetHours ?? 0), originalName: emp.name || '' })
                      }}
                      aria-label={tf('editEmployeeLabel', { name: emp.name })}
                    >
                      <Pencil size={12} aria-hidden />
                      <span>{t('edit')}</span>
                    </button>
                    <button
                      type="button"
                      className="team-card-arrow"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/employees/${emp.id}/availability`)
                      }}
                      aria-label={tf('availabilityForLabel', { name: emp.name })}
                    >
                      {t('availability')} <ArrowRight size={12} aria-hidden />
                    </button>
                  </div>
                </div>
              </Motion.div>
            ))}
          </div>
        )}
      </Section>
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <EmployeeDialog onClose={() => setEditing(null)} labelledBy="edit-employee-title">
            <div className="shift-modal-header">
              <h3 className="modal-title" id="edit-employee-title">{tf('editEmployeeTitle', { name: editing.originalName })}</h3>
              <button className="modal-close-btn" onClick={() => setEditing(null)} aria-label={t('close')}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="employee-form">
              <div className="employee-form-field">
                <label htmlFor="edit-employee-name" className="form-label">{t('name')}</label>
                <input id="edit-employee-name" type="text" className="input" data-autofocus value={editing.name}
                  onChange={e => setEditing(v => ({ ...v, name: e.target.value }))} />
              </div>
              <div className="employee-form-field">
                <label htmlFor="edit-employee-role" className="form-label">{t('role')}</label>
                <select id="edit-employee-role" className="input" value={editing.role}
                  onChange={e => setEditing(v => ({ ...v, role: e.target.value }))}>
                  {!rolesList.some(r => r.name === editing.role) && editing.role && <option value={editing.role}>{editing.role}</option>}
                  {rolesList.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
              <div className="employee-form-field employee-form-field-small">
                <label htmlFor="edit-employee-target" className="form-label">{t('targetHoursWeek')}</label>
                <input id="edit-employee-target" type="number" min="0" max="80" className="input" value={editing.targetHours}
                  onChange={e => setEditing(v => ({ ...v, targetHours: e.target.value }))} />
              </div>
              {editing.name.trim() && editing.name.trim() !== editing.originalName && (
                <p className="hint-text" role="note">{t('renameEmployeeNote')}</p>
              )}
            </div>
            <div className="shift-modal-actions">
              <div className="shift-modal-right">
                <button className="secondary-button" onClick={() => setEditing(null)}>{t('cancel')}</button>
                <button className="add-button" onClick={saveEmployeeDetails} disabled={savingEdit}>{savingEdit ? t('saving') : t('save')}</button>
              </div>
            </div>
          </EmployeeDialog>
        </div>
      )}
      {inviteModal && (
        <div className="modal-backdrop" onClick={() => setInviteModal(null)}>
          <EmployeeDialog onClose={() => setInviteModal(null)} labelledBy="invite-modal-title">
            <div className="shift-modal-header">
              <h3 className="modal-title" id="invite-modal-title">{t('inviteModalTitle')} {inviteModal.employeeName}</h3>
              <button type="button" className="modal-close-btn" onClick={() => setInviteModal(null)} aria-label={t('close')}>
                <X size={18} aria-hidden />
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
            <InviteEmailForm link={inviteModal.link} />
            <p className="invite-link-note">
              {t('inviteLinkNote')}
            </p>
          </EmployeeDialog>
        </div>
      )}
    </main>
  )
}

export default Employees
