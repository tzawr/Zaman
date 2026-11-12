import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ScheduleTable from '../components/ScheduleTable'
import {
  Loader2,
  Sparkles,
  Rocket,
  Calendar,
  X,
  Clipboard,
  ClipboardCheck,
  ArrowLeft,
  Download,
  FileText,
  Image,
  Filter,
  AlertTriangle,
} from 'lucide-react'
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  deleteDoc,
  doc,
  runTransaction,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import { exportToCSV, exportToPNG, exportToPDF } from '../utils/exportSchedule'
import { useI18n } from '../i18n'
import TeamsPublishButton from '../components/teams/TeamsPublishButton'
import { canExport, canViewRecommendationsForTier, getUserTier } from '../utils/tier'
import { formatWeekRange as formatWeek, scheduleDateProblem } from '../utils/weekDates'
import { revalidateSchedule } from '../utils/scheduleValidation'
import { loadSchedulingTeam } from '../utils/schedulingTeam'

function Schedules() {
  const navigate = useNavigate()
  const { currentUser, userData } = useAuth()
  const toast = useToast()
  const { t, tf, language } = useI18n()
  
  const [schedules, setSchedules] = useState([])
  const [selectedSchedule, setSelectedSchedule] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [exporting, setExporting] = useState(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [employees, setEmployees] = useState([])
  const [roles, setRoles] = useState([])
  // Workspace settings and the team as the scheduler sees it for the open
  // week, used to check every manual edit (HQA-09).
  const [workspace, setWorkspace] = useState(null)
  const [checkTeam, setCheckTeam] = useState(null)
  const [filterType, setFilterType] = useState('role')
  const [filterValue, setFilterValue] = useState('')
  const [tier, setTier] = useState('free')

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  useEffect(() => {
    if (!currentUser) return
    
    const q = query(
      collection(db, 'schedules'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'desc')
    )
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }))
      setSchedules(data)
      setLoading(false)
    }, (error) => {
      console.error('Error loading schedules:', error)
      setLoading(false)
    })
    
    return () => unsubscribe()
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    getUserTier(currentUser.uid).then(setTier).catch(() => setTier('free'))
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    const q = query(collection(db, 'employees'), where('userId', '==', currentUser.uid))
    return onSnapshot(q, snap => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    return onSnapshot(doc(db, 'users', currentUser.uid), snap => {
      if (snap.exists()) {
        setRoles(snap.data().roles || [])
        setWorkspace(snap.data())
      }
    })
  }, [currentUser])

  const openWeek = selectedSchedule?.weekStart
  const teamsBizId = workspace?.teamsBizId
  useEffect(() => {
    if (!currentUser || !openWeek) return
    let cancelled = false
    loadSchedulingTeam(currentUser.uid, employees, { teamsBizId, weekStart: openWeek })
      .then(r => { if (!cancelled) setCheckTeam(r.employees) })
      .catch(() => { if (!cancelled) setCheckTeam(null) })
    return () => { cancelled = true }
  }, [currentUser, employees, openWeek, teamsBizId])

  // A manual edit is checked again and saved together with its review items,
  // so history never shows Ready for a week an edit left short (HQA-09). The
  // save is a transaction on the week's revision: an edit made from a copy
  // another tab or person has since changed is refused, not written over it.
  async function handleScheduleUpdate(updatedData) {
    if (!selectedSchedule) return
    const base = selectedSchedule
    const checked = revalidateSchedule(updatedData, checkTeam || employees, {
      coverage: workspace?.coverage,
      operatingHours: workspace?.operatingHours,
    })
    setSelectedSchedule(prev => ({ ...prev, data: checked }))
    const ref = doc(db, 'schedules', base.id)
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) throw Object.assign(new Error('gone'), { code: 'schedule/gone' })
        const current = snap.data().revision || 0
        if (current !== (base.revision || 0)) {
          throw Object.assign(new Error('changed'), { code: 'schedule/conflict', latest: { id: snap.id, ...snap.data() } })
        }
        tx.update(ref, { data: checked, revision: current + 1 })
      })
      setSelectedSchedule(prev => (prev?.id === base.id ? { ...prev, data: checked, revision: (base.revision || 0) + 1 } : prev))
    } catch (err) {
      if (err.code === 'schedule/conflict') {
        setSelectedSchedule(err.latest)
        toast.error(t('scheduleEditConflict'))
        return
      }
      console.error('Failed to save:', err)
      setSelectedSchedule(prev => (prev?.id === base.id ? base : prev))
      toast.error(t('failedSaveChanges'))
    }
  }

  const formatWeekRange = (weekStart) => formatWeek(weekStart, language) || t('unknownWeek')

  function formatCreatedAt(timestamp) {
    if (!timestamp) return ''
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString(language === 'fa' ? 'fa-IR-u-nu-latn' : 'en-US', {
      month: 'short', 
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(language === 'fa' ? { hour12: false } : {})
    })
  }

  function scheduleHealth(sched) {
    const issueCount = sched.data?.issues?.length || 0
    if (issueCount > 0) return `${issueCount} ${issueCount === 1 ? t('reviewItem') : t('reviewItems')}`
    return t('ready')
  }

  // Records saved before the HQA-08 fix can carry dates that are not their
  // weekdays. They are shown as saved, with a warning; exports and
  // publishing stay off so wrong dates do not reach staff.
  const dateProblem = selectedSchedule ? scheduleDateProblem(selectedSchedule.weekStart, selectedSchedule.data) : null
  const dayName = (key) => t(`day${key.charAt(0).toUpperCase()}${key.slice(1)}`)

  async function handleExport(type) {
    if (!selectedSchedule?.data) return
    if (dateProblem) {
      toast.error(t('exportBlockedDates'))
      setExportMenuOpen(false)
      return
    }
    const gate = await canExport(currentUser.uid, type)
    if (gate.blocked) {
      toast.info(gate.message)
      setExportMenuOpen(false)
      return
    }
    setExporting(type)
    setExportMenuOpen(false)
    
    try {
      if (type === 'csv') {
        exportToCSV(selectedSchedule.data, selectedSchedule.weekStart)
      } else if (type === 'png') {
        await exportToPNG('schedule-export-target', selectedSchedule.weekStart)
      } else if (type === 'pdf') {
        await exportToPDF('schedule-export-target', selectedSchedule.weekStart)
      }
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(null)
    }
  }

  const roleOptions = roles
    .map(role => typeof role === 'string' ? role : role.name)
    .concat(getScheduleRoles(selectedSchedule?.data))
    .filter(Boolean)
    .filter((role, index, list) => list.indexOf(role) === index)
    .sort((a, b) => a.localeCompare(b))
  const employeeOptions = employees
    .map(emp => emp.name)
    .concat(getScheduleEmployees(selectedSchedule?.data))
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b))
  const activeHighlightFilter = filterValue ? { type: filterType, value: filterValue } : null
  const visibleSchedules = tier === 'pro' ? schedules : schedules.slice(0, 2)

  function copyToClipboard(text) {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleDelete(scheduleId) {
    try {
      await deleteDoc(doc(db, 'schedules', scheduleId))
      setConfirmDelete(null)
      if (selectedSchedule?.id === scheduleId) {
        setSelectedSchedule(null)
      }
    } catch (err) {
      console.error('Failed to delete:', err)
      toast.error(t('failedDelete'))
    }
  }

  if (loading) {
    return (
      <main className="schedules-page-full">
        <div className="empty-state">
          <p>{t('loadingSchedules')} <Loader2 size={16} className="spin" aria-hidden /></p>
        </div>
      </main>
    )
  }

  return (
    <main className="schedules-page-full">
      <div className="schedules-page-header-wrap">
        <button 
          className="app-back-link"
          onClick={() => navigate('/dashboard')}
        >
          <ArrowLeft size={14} />
          <span>{t('backToDashboard')}</span>
        </button>

        <PageHero
          eyebrow={t('historyEyebrow')}
          title={t('schedulesTitle')}
          subtitle={t('schedulesSubtitle')}
        >
          <div className="page-hero-actions">
            <button 
              className="landing-cta-primary"
              onClick={() => navigate('/schedule')}
            >
              <Sparkles size={16} />
              <span>{t('generateNew')}</span>
            </button>
          </div>
        </PageHero>
      </div>

      {visibleSchedules.length === 0 ? (
        <div className="schedules-empty-state">
          <Rocket size={40} />
          <p>{t('noSchedulesYet')}</p>
          <button 
            className="landing-cta-primary"
            onClick={() => navigate('/schedule')}
          >
            <Sparkles size={16} />
            <span>{t('generateYourFirst')}</span>
          </button>
        </div>
      ) : (
        <div className="schedules-split">
          <aside className="schedules-sidebar">
            <div className="schedules-sidebar-head">
              <h3 className="schedules-sidebar-title">{t('allSchedules')}</h3>
              <span>{visibleSchedules.length}</span>
            </div>
            <div className="schedule-list">
              {visibleSchedules.map(sched => (
                <div 
                  key={sched.id}
                  className={`schedule-card ${selectedSchedule?.id === sched.id ? 'selected' : ''}`}
                  onClick={() => setSelectedSchedule(sched)}
                >
                  <div className="schedule-card-header">
                    <button
                      type="button"
                      className="schedule-week schedule-open"
                      onClick={(e) => { e.stopPropagation(); setSelectedSchedule(sched) }}
                      aria-pressed={selectedSchedule?.id === sched.id}
                      aria-label={`${t('openSchedule')}: ${formatWeekRange(sched.weekStart)}, ${scheduleHealth(sched)}`}
                    >
                      <Calendar size={14} className="schedule-week-icon" aria-hidden />
                      {formatWeekRange(sched.weekStart)}
                      {scheduleDateProblem(sched.weekStart, sched.data) && (
                        <span className="schedule-date-badge">{t('dateProblemBadge')}</span>
                      )}
                    </button>
                    <button 
                      className="schedule-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete(sched.id)
                      }}
                      aria-label={t('deleteSchedule')}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p className="schedule-meta">
                    {t('generated')} {formatCreatedAt(sched.createdAt)}
                  </p>
                  <div className="schedule-card-tags">
                    <span>{sched.employeeCount || '?'} {sched.employeeCount === 1 ? t('person') : t('people')}</span>
                    {sched.instructions && <span>{t('notes')}</span>}
                    <span className={sched.data?.issues?.length ? 'needs-review' : 'ready'}>{scheduleHealth(sched)}</span>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="schedules-main">
            {selectedSchedule ? (
              <>
                <div className="schedules-main-header">
                  <div>
                    <h2 className="schedules-main-title">
                      {formatWeekRange(selectedSchedule.weekStart)}
                    </h2>
                    <p className="schedule-meta">
                      {t('generated')} {formatCreatedAt(selectedSchedule.createdAt)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {selectedSchedule.data && userData?.teamsBizId && !dateProblem && <TeamsPublishButton schedule={selectedSchedule} />}
                    {selectedSchedule.data && (
                      <div className="export-dropdown-wrap">
                        <button 
                          className="settings-button"
                          onClick={() => setExportMenuOpen(!exportMenuOpen)}
                          disabled={exporting !== null || Boolean(dateProblem)}
                          title={dateProblem ? t('exportBlockedDates') : undefined}
                        >
                          {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                          <span>{exporting ? `${t('exporting')} ${exporting}...` : t('export')}</span>
                        </button>
                        {exportMenuOpen && (
                          <>
                            <div 
                              className="export-dropdown-backdrop"
                              onClick={() => setExportMenuOpen(false)}
                            />
                            <div className="export-dropdown">
                              <button className="export-dropdown-item" onClick={() => handleExport('csv')}>
                                <FileText size={15} />
                                <div>
                                  <div className="export-item-title">{t('exportCsvTitle')}</div>
                                  <div className="export-item-desc">{t('exportCsvDesc')}</div>
                                </div>
                              </button>
                              <button className="export-dropdown-item" onClick={() => handleExport('png')}>
                                <Image size={15} />
                                <div>
                                  <div className="export-item-title">{t('exportPngTitle')}</div>
                                  <div className="export-item-desc">{t('exportPngDesc')}</div>
                                </div>
                              </button>
                              <button className="export-dropdown-item" onClick={() => handleExport('pdf')}>
                                <FileText size={15} />
                                <div>
                                  <div className="export-item-title">{t('exportPdfTitle')}</div>
                                  <div className="export-item-desc">{t('exportPdfDesc')}</div>
                                </div>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    <button 
                      className="settings-button"
                      onClick={() => copyToClipboard(selectedSchedule.content)}
                    >
                      {copied ? <ClipboardCheck size={16} /> : <Clipboard size={16} />}
                      <span>{copied ? t('copied') : t('copy')}</span>
                    </button>
                  </div>
                </div>

                {selectedSchedule.instructions && (
                  <div className="schedule-instructions">
                    <p className="instructions-label">{t('customInstructions')}</p>
                    <p className="instructions-text">{selectedSchedule.instructions}</p>
                  </div>
                )}

                {selectedSchedule.data ? (
                  <>
                    <div className="schedule-filter-bar">
                      <div className="schedule-filter-label">
                        <Filter size={15} />
                        <span>{t('highlight')}</span>
                      </div>
                      <div className="schedule-filter-controls">
                        <div className="schedule-filter-segment">
                          <button
                            type="button"
                            className={filterType === 'role' ? 'active' : ''}
                            onClick={() => {
                              setFilterType('role')
                              setFilterValue('')
                            }}
                          >
                            {t('roleFilter')}
                          </button>
                          <button
                            type="button"
                            className={filterType === 'employee' ? 'active' : ''}
                            onClick={() => {
                              setFilterType('employee')
                              setFilterValue('')
                            }}
                          >
                            {t('personFilter')}
                          </button>
                        </div>
                        <select
                          className="input schedule-filter-select"
                          aria-label={t('a11yFilterSchedule')}
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                        >
                          <option value="">
                            {filterType === 'role' ? t('allRoles') : t('allPeople')}
                          </option>
                          {(filterType === 'role' ? roleOptions : employeeOptions).map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        {filterValue && (
                          <button
                            type="button"
                            className="schedule-filter-clear"
                            onClick={() => setFilterValue('')}
                          >
                            {t('clear')}
                          </button>
                        )}
                      </div>
                    </div>
                    {dateProblem && (
                      <div className="setup-blocked schedule-date-problem" role="alert">
                        <div className="setup-blocked-head">
                          <AlertTriangle size={15} aria-hidden />
                          <span>{t('dateProblemTitle')}</span>
                        </div>
                        <p className="setup-blocked-message">
                          {dateProblem.kind === 'invalid'
                            ? t('exportBlockedDates')
                            : dateProblem.kind === 'dates_mismatch'
                            ? tf('dateProblemMismatch', { day: dayName(dateProblem.day), date: dateProblem.date })
                            : tf('dateProblemNotMonday', { weekday: dayName(String(dateProblem.savedWeekday || '').toLowerCase() || 'monday'), date: dateProblem.savedWeekStart, monday: dateProblem.monday || '' })}
                        </p>
                        {dateProblem.monday && (
                          <button type="button" className="settings-button" onClick={() => navigate(`/schedule?week=${dateProblem.monday}`)}>
                            {t('dateProblemRebuild')}
                          </button>
                        )}
                      </div>
                    )}
                    <ScheduleTable
                      data={selectedSchedule.data}
                      employees={employees}
                      roles={roles}
                      onUpdate={handleScheduleUpdate}
                      highlightFilter={activeHighlightFilter}
                      showRecommendations={canViewRecommendationsForTier(tier)}
                    />
                  </>
                ) : (
                  <div className="schedule-output">
                    <pre>{selectedSchedule.content}</pre>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state schedules-empty">
                <Calendar size={40} />
                <p>{t('selectSchedulePrompt')}</p>
              </div>
            )}
          </section>
        </div>
      )}

      {confirmDelete && (
        <div 
          className="modal-backdrop"
          onClick={() => setConfirmDelete(null)}
        >
          <div 
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">{t('deleteThisSchedule')}</h3>
            <p className="modal-text">
              {t('cannotBeUndone')}
            </p>
            <div className="modal-actions">
              <button 
                className="secondary-button"
                onClick={() => setConfirmDelete(null)}
              >
                {t('cancel')}
              </button>
              <button 
                className="danger-button"
                onClick={() => handleDelete(confirmDelete)}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function getScheduleRoles(data) {
  const roles = []
  Object.values(data?.days || {}).forEach(day => {
    ;(day.shifts || []).forEach(shift => {
      if (shift.role) roles.push(shift.role)
    })
  })
  ;(data?.summary || []).forEach(row => {
    if (row.role) roles.push(row.role)
  })
  return roles
}

function getScheduleEmployees(data) {
  const names = []
  Object.values(data?.days || {}).forEach(day => {
    ;(day.shifts || []).forEach(shift => {
      if (shift.employee) names.push(shift.employee)
    })
  })
  ;(data?.summary || []).forEach(row => {
    if (row.employee) names.push(row.employee)
  })
  return names
}

export default Schedules
