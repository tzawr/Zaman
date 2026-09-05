import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion as Motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Plus,
  X,
  Sparkles,
  Users,
  Clock,
  Target,
  CalendarCheck,
  Check,
  Lightbulb,
  Link2,
  Copy,
  ClipboardList,
  UserCircle,
} from 'lucide-react'
import {
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import TimeSelect from '../components/TimeSelect'
import { canAddEmployee, canInviteEmployees } from '../utils/tier'
import { getSetupStatus, employeeHasAvailability } from '../utils/setupChecklist'

const DAYS = [
  { key: 'monday', labelKey: 'dayMonday' },
  { key: 'tuesday', labelKey: 'dayTuesday' },
  { key: 'wednesday', labelKey: 'dayWednesday' },
  { key: 'thursday', labelKey: 'dayThursday' },
  { key: 'friday', labelKey: 'dayFriday' },
  { key: 'saturday', labelKey: 'daySaturday' },
  { key: 'sunday', labelKey: 'daySunday' },
]

const DEFAULT_HOURS = DAYS.reduce((acc, d) => {
  acc[d.key] = { open: d.key !== 'sunday', start: '07:00', end: '22:00' }
  return acc
}, {})

const DEFAULT_COVERAGE = DAYS.reduce((acc, d) => {
  acc[d.key] = { minPeople: 2 }
  return acc
}, {})

const DEFAULT_AVAIL = DAYS.reduce((acc, d) => {
  acc[d.key] = { available: true, start: '09:00', end: '17:00' }
  return acc
}, {})

const STEPS = [
  { id: 1, labelKey: 'setupNavProfile', icon: UserCircle },
  { id: 2, labelKey: 'setupNavRoles', icon: Users },
  { id: 3, labelKey: 'setupNavHours', icon: Clock },
  { id: 4, labelKey: 'setupNavCoverage', icon: Target },
  { id: 5, labelKey: 'setupNavTeam', icon: Users },
  { id: 6, labelKey: 'setupNavAvailability', icon: CalendarCheck },
  { id: 7, labelKey: 'setupNavReview', icon: ClipboardList },
]

const LAST_STEP = STEPS.length

// Steps 3 onward show day grids and team lists, which need a wider card than
// the two original name/role steps.
const WIDE_STEPS = [3, 4, 5, 6, 7]

function SetupGuide({ title, points, example, t }) {
  return (
    <div className="setup-guide">
      <div className="setup-guide-head">
        <Lightbulb size={13} aria-hidden />
        <span>{title || t('setupHowItWorks')}</span>
      </div>
      <ul className="setup-guide-list">
        {points.map(point => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {example && (
        <div className="setup-example">
          <span className="setup-example-label">{t('setupExample')}</span>
          <span className="setup-example-text">{example}</span>
        </div>
      )}
    </div>
  )
}

function Onboarding() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const { t, tf } = useI18n()

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Step 1 — about the manager
  const [displayName, setDisplayName] = useState('')
  const [userRole, setUserRole] = useState('')

  // Step 2 — job roles
  const [roles, setRoles] = useState([])
  const [newRole, setNewRole] = useState('')

  // Steps 3 & 4 — workspace. The day grids are pre-filled with sensible
  // defaults, so a step only counts as answered once the manager submits it;
  // skipping must leave the workspace genuinely empty rather than silently
  // saving defaults the manager never looked at.
  const [operatingHours, setOperatingHours] = useState(DEFAULT_HOURS)
  const [coverage, setCoverage] = useState(DEFAULT_COVERAGE)
  const [answered, setAnswered] = useState({ hours: false, coverage: false })

  // Step 5 — team
  const [employees, setEmployees] = useState([])
  const [empName, setEmpName] = useState('')
  const [empRole, setEmpRole] = useState('')
  const [empHours, setEmpHours] = useState(25)
  const [addingEmployee, setAddingEmployee] = useState(false)

  // Step 6 — availability
  const [openEmployeeId, setOpenEmployeeId] = useState(null)
  const [availabilityDraft, setAvailabilityDraft] = useState({})
  const [inviteModal, setInviteModal] = useState(null)

  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
      return
    }
    async function loadExisting() {
      const snap = await getDoc(doc(db, 'users', currentUser.uid))
      if (snap.exists()) {
        const data = snap.data()
        if (data.onboarded) {
          navigate(data.accountType === 'employee' ? '/my-schedule' : '/dashboard')
          return
        }
        if (data.displayName) setDisplayName(data.displayName)
        if (data.userRole) setUserRole(data.userRole)
        if (data.roles) setRoles(data.roles)
        if (data.operatingHours) {
          setOperatingHours(data.operatingHours)
          setAnswered(prev => ({ ...prev, hours: true }))
        }
        if (data.coverage) {
          setCoverage(data.coverage)
          setAnswered(prev => ({ ...prev, coverage: true }))
        }
      }
      setLoading(false)
    }
    loadExisting()
  }, [currentUser, navigate])

  // The team list stays live so availability saved in step 6 is reflected
  // immediately in the review step.
  useEffect(() => {
    if (!currentUser) return
    const q = query(collection(db, 'employees'), where('userId', '==', currentUser.uid))
    const unsub = onSnapshot(q, snap => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [currentUser])

  const persist = useCallback(async (updates) => {
    if (!currentUser) return
    try {
      await setDoc(
        doc(db, 'users', currentUser.uid),
        { email: currentUser.email, ...updates },
        { merge: true }
      )
    } catch {
      toast.error(t('failedToSave'))
    }
  }, [currentUser, toast, t])

  function goTo(next) {
    setStep(Math.min(Math.max(next, 1), LAST_STEP))
  }

  /* ---------- Step 1 ---------- */
  async function submitProfile() {
    if (!displayName.trim()) {
      toast.info(t('toastEnterYourName'))
      return
    }
    if (!userRole.trim()) {
      toast.info(t('toastEnterYourRole'))
      return
    }
    await persist({ displayName: displayName.trim(), userRole: userRole.trim() })
    goTo(2)
  }

  /* ---------- Step 2 ---------- */
  function addRole() {
    const name = newRole.trim()
    if (!name) return
    if (roles.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      toast.info(t('toastRoleAlreadyAdded'))
      return
    }
    setRoles([...roles, { id: Date.now().toString(), name }])
    setNewRole('')
  }

  function removeRole(id) {
    setRoles(roles.filter(r => r.id !== id))
  }

  async function submitRoles() {
    await persist({ roles })
    goTo(3)
  }

  /* ---------- Step 3 ---------- */
  function toggleDay(key) {
    setOperatingHours(prev => ({
      ...prev,
      [key]: { ...prev[key], open: !prev[key].open },
    }))
  }

  function updateHour(key, field, value) {
    setOperatingHours(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
  }

  async function submitHours() {
    setAnswered(prev => ({ ...prev, hours: true }))
    await persist({ operatingHours })
    goTo(4)
  }

  /* ---------- Step 4 ---------- */
  function updateCoverage(key, value) {
    const n = parseInt(value, 10) || 0
    setCoverage(prev => ({ ...prev, [key]: { minPeople: n } }))
  }

  async function submitCoverage() {
    setAnswered(prev => ({ ...prev, coverage: true }))
    await persist({ coverage })
    goTo(5)
  }

  /* ---------- Step 5 ---------- */
  async function addEmployee() {
    const name = empName.trim()
    const role = empRole.trim()
    if (!name) {
      toast.info(t('toastEnterName'))
      return
    }
    if (!role) {
      toast.info(t('toastSelectRole'))
      return
    }
    // Names are the scheduler's identifier for a person; duplicates would share
    // shifts and double up in the hours summary.
    if (employees.some(emp => emp.name?.trim().toLowerCase() === name.toLowerCase())) {
      toast.info(tf('toastDuplicateName', { name }))
      return
    }
    const hrs = Number(empHours)
    if (Number.isNaN(hrs) || hrs < 0 || hrs > 80) {
      toast.info(t('toastTargetHoursRange'))
      return
    }
    const gate = await canAddEmployee(currentUser.uid, employees.length)
    if (gate.blocked) {
      toast.info(gate.message)
      return
    }
    try {
      setAddingEmployee(true)
      await addDoc(collection(db, 'employees'), {
        userId: currentUser.uid,
        name,
        role,
        targetHours: hrs,
        availability: {},
        timeOff: [],
        createdAt: serverTimestamp(),
      })
      setEmpName('')
      toast.success(`${t('addedPrefix')} ${name}`)
    } catch (err) {
      console.error(err)
      toast.error(t('toastFailedAdd'))
    } finally {
      setAddingEmployee(false)
    }
  }

  /* ---------- Step 6 ---------- */
  function openAvailability(employee) {
    if (openEmployeeId === employee.id) {
      setOpenEmployeeId(null)
      return
    }
    setAvailabilityDraft(prev => ({
      ...prev,
      [employee.id]: {
        ...DEFAULT_AVAIL,
        ...(employee.availability && Object.keys(employee.availability).length > 0
          ? employee.availability
          : {}),
      },
    }))
    setOpenEmployeeId(employee.id)
  }

  function toggleAvailabilityDay(employeeId, dayKey) {
    setAvailabilityDraft(prev => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [dayKey]: {
          ...prev[employeeId][dayKey],
          available: !prev[employeeId][dayKey].available,
        },
      },
    }))
  }

  function updateAvailabilityTime(employeeId, dayKey, field, value) {
    setAvailabilityDraft(prev => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [dayKey]: { ...prev[employeeId][dayKey], [field]: value },
      },
    }))
  }

  async function saveAvailability(employee) {
    const draft = availabilityDraft[employee.id]
    if (!draft) return
    try {
      setSaving(true)
      await updateDoc(doc(db, 'employees', employee.id), {
        availability: draft,
        availabilityUpdatedAt: serverTimestamp(),
        availabilityUpdatedBy: currentUser.uid,
        availabilityUpdatedByType: 'manager',
      })
      setOpenEmployeeId(null)
      toast.success(`${t('setupAvailabilitySet')} — ${employee.name}`)
    } catch {
      toast.error(t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  async function sendInvite(employee) {
    const gate = await canInviteEmployees(currentUser.uid)
    if (gate.blocked) {
      toast.info(gate.message)
      return
    }
    try {
      const token = crypto.randomUUID()
      await setDoc(doc(db, 'invites', token), {
        managerId: currentUser.uid,
        employeeId: employee.id,
        employeeName: employee.name,
        employeeRole: employee.role,
        allowEmployeeFullView: false,
        allowEmployeeAvailabilityUpdates: true,
        createdAt: serverTimestamp(),
        used: false,
      })
      setInviteModal({
        employeeName: employee.name,
        link: `${window.location.origin}/invite/${token}`,
        copied: false,
      })
    } catch {
      toast.error(t('failedToSave'))
    }
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteModal.link)
    setInviteModal(m => ({ ...m, copied: true }))
    setTimeout(() => setInviteModal(m => (m ? { ...m, copied: false } : m)), 2000)
  }

  /* ---------- Step 7 ---------- */
  async function finishSetup() {
    try {
      setSaving(true)
      await persist({
        displayName: displayName.trim(),
        userRole: userRole.trim(),
        roles,
        ...(answered.hours ? { operatingHours } : {}),
        ...(answered.coverage ? { coverage } : {}),
        onboarded: true,
        createdAt: serverTimestamp(),
      })
      navigate('/dashboard')
    } catch (err) {
      console.error(err)
      toast.error(t('toastFailedAdd'))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <div className="empty-state"><p>{t('loading')}</p></div>
      </main>
    )
  }

  // Review reflects what will actually be saved, so a skipped hours step reads
  // as incomplete even though the grid on screen showed defaults.
  const status = getSetupStatus({
    userData: { roles, operatingHours: answered.hours ? operatingHours : null },
    employees,
  })

  const reviewRows = [
    { key: 'roles', label: t('setupNavRoles'), item: status.roles, step: 2 },
    { key: 'hours', label: t('setupNavHours'), item: status.hours, step: 3 },
    { key: 'team', label: t('setupNavTeam'), item: status.team, step: 5 },
    { key: 'availability', label: t('setupNavAvailability'), item: status.availability, step: 6 },
  ]

  return (
    <main className="auth-page">
      <div className="auth-bg">
        <Motion.div
          className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Motion.div
          className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <Motion.div
        className={`auth-card onboarding-card${WIDE_STEPS.includes(step) ? ' onboarding-card-wide' : ''}`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="setup-rail" role="list">
          {STEPS.map(s => (
            <button
              key={s.id}
              type="button"
              role="listitem"
              className={`setup-rail-step${step === s.id ? ' current' : ''}${step > s.id ? ' done' : ''}`}
              onClick={() => goTo(s.id)}
            >
              <span className="setup-rail-dot">
                {step > s.id ? <Check size={11} /> : s.id}
              </span>
              <span className="setup-rail-label">{t(s.labelKey)}</span>
            </button>
          ))}
        </div>
        <p className="setup-step-count">
          {tf('setupStepOf', { current: step, total: LAST_STEP })}
        </p>

        <AnimatePresence mode="wait">
          {/* ---------- Step 1: about you ---------- */}
          {step === 1 && (
            <Motion.div key="step1" {...stepMotion}>
              <div className="auth-eyebrow">
                <Sparkles size={14} />
                <span>{t('onboardingStep1')}</span>
              </div>
              <h1 className="auth-title">{t('onboardingTitle1')}</h1>
              <p className="auth-subtitle">{t('onboardingSubtitle1')}</p>

              <div className="auth-form">
                <div className="auth-field">
                  <label className="form-label">{t('yourName')}</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={t('employeeNamePlaceholder')}
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="auth-field">
                  <label className="form-label">{t('yourRoleQuestion')}</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={t('roleExamplePlaceholder')}
                    value={userRole}
                    onChange={e => setUserRole(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitProfile()}
                  />
                </div>
                <button className="landing-cta-primary auth-submit" onClick={submitProfile}>
                  <span>{t('continue')}</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </Motion.div>
          )}

          {/* ---------- Step 2: roles ---------- */}
          {step === 2 && (
            <Motion.div key="step2" {...stepMotion}>
              <div className="auth-eyebrow">
                <Users size={14} />
                <span>{t('setupNavRoles')}</span>
              </div>
              <h1 className="auth-title">{t('setupRolesTitle')}</h1>
              <p className="auth-subtitle">{t('setupRolesSubtitle')}</p>

              <SetupGuide
                t={t}
                points={[t('setupRolesGuide1'), t('setupRolesGuide2'), t('setupRolesGuide3')]}
                example={t('setupRolesExample')}
              />

              <div className="auth-form">
                <div className="inline-form-row">
                  <input
                    type="text"
                    className="input"
                    placeholder={t('baristaPlaceholder')}
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRole())}
                    autoFocus
                  />
                  <button className="add-button" onClick={addRole}>
                    <Plus size={14} />
                    <span>{t('add')}</span>
                  </button>
                </div>

                {roles.length > 0 && (
                  <div className="onboarding-roles">
                    {roles.map(r => (
                      <div key={r.id} className="onboarding-role-chip">
                        <span>{r.name}</span>
                        <button onClick={() => removeRole(r.id)} aria-label={`Remove ${r.name}`}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <StepActions
                  t={t}
                  onBack={() => goTo(1)}
                  onSkip={() => goTo(3)}
                  onNext={submitRoles}
                />
              </div>
            </Motion.div>
          )}

          {/* ---------- Step 3: operating hours ---------- */}
          {step === 3 && (
            <Motion.div key="step3" {...stepMotion}>
              <div className="auth-eyebrow">
                <Clock size={14} />
                <span>{t('setupNavHours')}</span>
              </div>
              <h1 className="auth-title">{t('setupHoursTitle')}</h1>
              <p className="auth-subtitle">{t('setupHoursSubtitle')}</p>

              <SetupGuide
                t={t}
                points={[t('setupHoursGuide1'), t('setupHoursGuide2'), t('setupHoursGuide3')]}
                example={t('setupHoursExample')}
              />

              <div className="day-list">
                {DAYS.map(day => {
                  const d = operatingHours[day.key] || DEFAULT_HOURS[day.key]
                  return (
                    <div key={day.key} className={`day-row ${d.open ? 'available' : 'unavailable'}`}>
                      <button className="day-toggle" onClick={() => toggleDay(day.key)}>
                        <span className="day-name">{t(day.labelKey)}</span>
                        <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {d.open
                            ? <><Check size={16} /><span>{t('open')}</span></>
                            : <><X size={16} /><span>{t('closed')}</span></>}
                        </span>
                      </button>
                      {d.open && (
                        <div className="time-inputs">
                          <TimeSelect value={d.start} onChange={v => updateHour(day.key, 'start', v)} />
                          <span className="time-arrow"><ArrowRight size={16} /></span>
                          <TimeSelect value={d.end} onChange={v => updateHour(day.key, 'end', v)} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <StepActions t={t} onBack={() => goTo(2)} onSkip={() => goTo(4)} onNext={submitHours} />
            </Motion.div>
          )}

          {/* ---------- Step 4: coverage ---------- */}
          {step === 4 && (
            <Motion.div key="step4" {...stepMotion}>
              <div className="auth-eyebrow">
                <Target size={14} />
                <span>{t('setupNavCoverage')}</span>
                <span className="setup-optional-pill">{t('setupOptional')}</span>
              </div>
              <h1 className="auth-title">{t('setupCoverageTitle')}</h1>
              <p className="auth-subtitle">{t('setupCoverageSubtitle')}</p>

              <SetupGuide
                t={t}
                points={[t('setupCoverageGuide1'), t('setupCoverageGuide2'), t('setupCoverageGuide3')]}
                example={t('setupCoverageExample')}
              />

              <div className="day-list">
                {DAYS.map(day => {
                  const d = operatingHours[day.key] || DEFAULT_HOURS[day.key]
                  const c = coverage[day.key]?.minPeople ?? 2
                  return (
                    <div key={day.key} className={`day-row ${d.open ? 'available' : 'unavailable'}`}>
                      <div className="day-toggle">
                        <span className="day-name">{t(day.labelKey)}</span>
                        <span className="day-status">{d.open ? t('open') : t('closed')}</span>
                      </div>
                      {d.open && (
                        <div className="coverage-input-wrapper">
                          <input
                            type="number"
                            min="1"
                            max="20"
                            className="time-input coverage-input"
                            value={c}
                            onChange={e => updateCoverage(day.key, e.target.value)}
                          />
                          <span className="coverage-label">
                            {c === 1 ? t('person') : t('people')} {t('min')}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <StepActions t={t} onBack={() => goTo(3)} onSkip={() => goTo(5)} onNext={submitCoverage} />
            </Motion.div>
          )}

          {/* ---------- Step 5: team ---------- */}
          {step === 5 && (
            <Motion.div key="step5" {...stepMotion}>
              <div className="auth-eyebrow">
                <Users size={14} />
                <span>{t('setupNavTeam')}</span>
              </div>
              <h1 className="auth-title">{t('setupTeamTitle')}</h1>
              <p className="auth-subtitle">{t('setupTeamSubtitle')}</p>

              <SetupGuide
                t={t}
                points={[t('setupTeamGuide1'), t('setupTeamGuide2'), t('setupTeamGuide3')]}
                example={t('setupTeamExample')}
              />

              <div className="setup-team-form">
                <div className="employee-form-field">
                  <label className="form-label">{t('name')}</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={t('employeeNamePlaceholder')}
                    value={empName}
                    onChange={e => setEmpName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addEmployee()}
                  />
                </div>
                <div className="employee-form-field">
                  <label className="form-label">{t('role')}</label>
                  {roles.length > 0 ? (
                    <select
                      className="input"
                      value={empRole}
                      onChange={e => setEmpRole(e.target.value)}
                    >
                      <option value="">{t('selectRole')}</option>
                      {roles.map(r => (
                        <option key={r.id} value={r.name}>{r.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="input"
                      placeholder={t('baristaPlaceholder')}
                      value={empRole}
                      onChange={e => setEmpRole(e.target.value)}
                    />
                  )}
                </div>
                <div className="employee-form-field setup-team-hours">
                  <label className="form-label">{t('targetHoursWeek')}</label>
                  <input
                    type="number"
                    min="0"
                    max="80"
                    className="input"
                    value={empHours}
                    onChange={e => setEmpHours(e.target.value)}
                  />
                </div>
                <button className="add-button" onClick={addEmployee} disabled={addingEmployee}>
                  <Plus size={14} />
                  <span>{t('add')}</span>
                </button>
              </div>

              <div className="setup-team-list">
                <div className="setup-list-heading">{t('setupTeamAdded')}</div>
                {employees.length === 0 ? (
                  <p className="role-empty">{t('setupTeamNobody')}</p>
                ) : (
                  employees.map(emp => (
                    <div key={emp.id} className="setup-person-row">
                      <div className="employee-avatar">{emp.name[0]?.toUpperCase()}</div>
                      <div className="setup-person-info">
                        <div className="setup-person-name">{emp.name}</div>
                        <div className="setup-person-meta">
                          {emp.role}{emp.targetHours !== undefined && ` • ${emp.targetHours}h`}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <StepActions t={t} onBack={() => goTo(4)} onSkip={() => goTo(6)} onNext={() => goTo(6)} />
            </Motion.div>
          )}

          {/* ---------- Step 6: availability ---------- */}
          {step === 6 && (
            <Motion.div key="step6" {...stepMotion}>
              <div className="auth-eyebrow">
                <CalendarCheck size={14} />
                <span>{t('setupNavAvailability')}</span>
              </div>
              <h1 className="auth-title">{t('setupAvailabilityTitle')}</h1>
              <p className="auth-subtitle">{t('setupAvailabilitySubtitle')}</p>

              <SetupGuide
                t={t}
                points={[
                  t('setupAvailabilityGuide1'),
                  t('setupAvailabilityGuide2'),
                  t('setupAvailabilityGuide3'),
                ]}
                example={t('setupAvailabilityExample')}
              />

              {employees.length === 0 ? (
                <div className="empty-state">
                  <Users size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
                  <p>{t('setupAvailabilityNoTeam')}</p>
                  <button className="add-button" style={{ marginTop: 12 }} onClick={() => goTo(5)}>
                    {t('addTeamMembers')}
                  </button>
                </div>
              ) : (
                <div className="setup-team-list">
                  {employees.map(emp => {
                    const filled = employeeHasAvailability(emp)
                    const expanded = openEmployeeId === emp.id
                    const draft = availabilityDraft[emp.id]
                    return (
                      <div key={emp.id} className={`setup-avail-card${expanded ? ' expanded' : ''}`}>
                        <div className="setup-person-row">
                          <div className="employee-avatar">{emp.name[0]?.toUpperCase()}</div>
                          <div className="setup-person-info">
                            <div className="setup-person-name">{emp.name}</div>
                            <div className={`setup-person-status${filled ? ' ok' : ''}`}>
                              {filled
                                ? <><Check size={12} /> {t('setupAvailabilitySet')}</>
                                : t('setupAvailabilityNotSet')}
                            </div>
                          </div>
                          <div className="setup-avail-actions">
                            <button className="settings-button" onClick={() => openAvailability(emp)}>
                              <Clock size={13} />
                              <span>{t('setupAvailabilityFillMyself')}</span>
                            </button>
                            <button className="dashboard-invite-btn" onClick={() => sendInvite(emp)}>
                              <Link2 size={13} />
                              <span>{t('setupAvailabilitySendInvite')}</span>
                            </button>
                          </div>
                        </div>

                        {expanded && draft && (
                          <div className="setup-avail-editor">
                            <div className="day-list">
                              {DAYS.map(day => {
                                const d = draft[day.key]
                                return (
                                  <div key={day.key} className={`day-row ${d.available ? 'available' : 'unavailable'}`}>
                                    <button
                                      className="day-toggle"
                                      onClick={() => toggleAvailabilityDay(emp.id, day.key)}
                                    >
                                      <span className="day-name">{t(day.labelKey)}</span>
                                      <span className="day-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        {d.available
                                          ? <><Check size={16} /><span>{t('available')}</span></>
                                          : <><X size={16} /><span>{t('off')}</span></>}
                                      </span>
                                    </button>
                                    {d.available && (
                                      <div className="time-inputs">
                                        <TimeSelect
                                          value={d.start}
                                          onChange={v => updateAvailabilityTime(emp.id, day.key, 'start', v)}
                                        />
                                        <span className="time-arrow"><ArrowRight size={16} /></span>
                                        <TimeSelect
                                          value={d.end}
                                          onChange={v => updateAvailabilityTime(emp.id, day.key, 'end', v)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                            <div className="avail-save-row">
                              <button
                                className="avail-save-btn"
                                onClick={() => saveAvailability(emp)}
                                disabled={saving}
                              >
                                <Check size={14} />
                                <span>{t('save')}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <StepActions t={t} onBack={() => goTo(5)} onSkip={() => goTo(7)} onNext={() => goTo(7)} />
            </Motion.div>
          )}

          {/* ---------- Step 7: review ---------- */}
          {step === 7 && (
            <Motion.div key="step7" {...stepMotion}>
              <div className="auth-eyebrow">
                <ClipboardList size={14} />
                <span>{t('setupNavReview')}</span>
              </div>
              <h1 className="auth-title">{t('setupReviewTitle')}</h1>
              <p className="auth-subtitle">
                {reviewRows.every(r => r.item.complete)
                  ? t('setupReviewSubtitleReady')
                  : t('setupReviewSubtitleMissing')}
              </p>

              <div className="setup-review-list">
                {reviewRows.map(row => (
                  <button
                    key={row.key}
                    type="button"
                    className={`setup-review-row${row.item.complete ? ' done' : ''}`}
                    onClick={() => goTo(row.step)}
                  >
                    <span className="setup-review-icon">
                      {row.item.complete ? <Check size={14} /> : <X size={14} />}
                    </span>
                    <span className="setup-review-label">{row.label}</span>
                    <span className="setup-review-state">
                      {row.item.complete ? t('setupDone') : t('setupIncomplete')}
                    </span>
                    <ArrowRight size={14} className="setup-review-arrow" />
                  </button>
                ))}
              </div>

              <div className="onboarding-actions">
                <button className="settings-button" onClick={() => goTo(6)} disabled={saving}>
                  {t('setupBack')}
                </button>
                <button className="landing-cta-primary" onClick={finishSetup} disabled={saving}>
                  <span>{saving ? t('setupFinishing') : t('setupFinish')}</span>
                  {!saving && <ArrowRight size={16} />}
                </button>
              </div>
            </Motion.div>
          )}
        </AnimatePresence>
      </Motion.div>

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
              {tf('setupInviteCopyHint', { name: inviteModal.employeeName })}
            </p>
            <div className="invite-link-box">
              <span className="invite-link-text">{inviteModal.link}</span>
              <button className="invite-copy-btn" onClick={copyInviteLink}>
                {inviteModal.copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{inviteModal.copied ? t('copied') : t('copy')}</span>
              </button>
            </div>
            <p className="invite-link-note">{t('inviteLinkNote')}</p>
          </div>
        </div>
      )}
    </main>
  )
}

const stepMotion = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.3 },
}

function StepActions({ t, onBack, onSkip, onNext }) {
  return (
    <div className="setup-actions">
      <button className="settings-button" onClick={onBack}>{t('setupBack')}</button>
      <div className="setup-actions-right">
        <button className="link-button setup-skip" onClick={onSkip}>{t('setupSkipStep')}</button>
        <button className="landing-cta-primary" onClick={onNext}>
          <span>{t('setupContinue')}</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}

export default Onboarding
