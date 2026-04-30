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
} from 'lucide-react'
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  deleteDoc,
  doc,
  updateDoc
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'
import PageHero from '../components/PageHero'
import { exportToCSV, exportToPNG, exportToPDF } from '../utils/exportSchedule'

function Schedules() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  
  const [schedules, setSchedules] = useState([])
  const [selectedSchedule, setSelectedSchedule] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [exporting, setExporting] = useState(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [employees, setEmployees] = useState([])
  const [roles, setRoles] = useState([])
  const [filterType, setFilterType] = useState('role')
  const [filterValue, setFilterValue] = useState('')

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
    const q = query(collection(db, 'employees'), where('userId', '==', currentUser.uid))
    return onSnapshot(q, snap => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    return onSnapshot(doc(db, 'users', currentUser.uid), snap => {
      if (snap.exists()) setRoles(snap.data().roles || [])
    })
  }, [currentUser])

  async function handleScheduleUpdate(updatedData) {
    if (!selectedSchedule) return
    setSelectedSchedule(prev => ({ ...prev, data: updatedData }))
    try {
      await updateDoc(doc(db, 'schedules', selectedSchedule.id), { data: updatedData })
    } catch (err) {
      console.error('Failed to save:', err)
      toast.error('Failed to save changes')
    }
  }

  function formatWeekRange(mondayStr) {
    if (!mondayStr) return 'Unknown week'
    const monday = new Date(mondayStr + 'T12:00:00')
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    
    const format = (d) => d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })
    
    return `${format(monday)} — ${format(sunday)}, ${monday.getFullYear()}`
  }

  function formatCreatedAt(timestamp) {
    if (!timestamp) return ''
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  function scheduleHealth(sched) {
    const issueCount = sched.data?.issues?.length || 0
    if (issueCount > 0) return `${issueCount} review ${issueCount === 1 ? 'item' : 'items'}`
    return 'Ready'
  }

  async function handleExport(type) {
    if (!selectedSchedule?.data) return
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
      toast.error('Failed to delete. Try again.')
    }
  }

  if (loading) {
    return (
      <main className="schedules-page-full">
        <div className="empty-state">
          <p>Loading schedules... <Loader2 size={16} className="spin" aria-hidden /></p>
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
          <span>Back to dashboard</span>
        </button>

        <PageHero
          eyebrow="History"
          title="My schedules"
          subtitle="Every schedule you've generated, saved automatically."
        >
          <div className="page-hero-actions">
            <button 
              className="landing-cta-primary"
              onClick={() => navigate('/schedule')}
            >
              <Sparkles size={16} />
              <span>Generate new</span>
            </button>
          </div>
        </PageHero>
      </div>

      {schedules.length === 0 ? (
        <div className="schedules-empty-state">
          <Rocket size={40} />
          <p>No schedules yet.</p>
          <button 
            className="landing-cta-primary"
            onClick={() => navigate('/schedule')}
          >
            <Sparkles size={16} />
            <span>Generate your first</span>
          </button>
        </div>
      ) : (
        <div className="schedules-split">
          <aside className="schedules-sidebar">
            <div className="schedules-sidebar-head">
              <h3 className="schedules-sidebar-title">All schedules</h3>
              <span>{schedules.length}</span>
            </div>
            <div className="schedule-list">
              {schedules.map(sched => (
                <div 
                  key={sched.id}
                  className={`schedule-card ${selectedSchedule?.id === sched.id ? 'selected' : ''}`}
                  onClick={() => setSelectedSchedule(sched)}
                >
                  <div className="schedule-card-header">
                    <p className="schedule-week">
                      <Calendar size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                      {formatWeekRange(sched.weekStart)}
                    </p>
                    <button 
                      className="schedule-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete(sched.id)
                      }}
                      aria-label="Delete schedule"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <p className="schedule-meta">
                    Generated {formatCreatedAt(sched.createdAt)}
                  </p>
                  <div className="schedule-card-tags">
                    <span>{sched.employeeCount || '?'} {sched.employeeCount === 1 ? 'person' : 'people'}</span>
                    {sched.instructions && <span>Notes</span>}
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
                      Generated {formatCreatedAt(selectedSchedule.createdAt)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {selectedSchedule.data && (
                      <div className="export-dropdown-wrap">
                        <button 
                          className="settings-button"
                          onClick={() => setExportMenuOpen(!exportMenuOpen)}
                          disabled={exporting !== null}
                        >
                          {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                          <span>{exporting ? `Exporting ${exporting}...` : 'Export'}</span>
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
                                  <div className="export-item-title">CSV (Excel)</div>
                                  <div className="export-item-desc">Open in spreadsheet apps</div>
                                </div>
                              </button>
                              <button className="export-dropdown-item" onClick={() => handleExport('png')}>
                                <Image size={15} />
                                <div>
                                  <div className="export-item-title">PNG Image</div>
                                  <div className="export-item-desc">Share screenshot</div>
                                </div>
                              </button>
                              <button className="export-dropdown-item" onClick={() => handleExport('pdf')}>
                                <FileText size={15} />
                                <div>
                                  <div className="export-item-title">PDF Document</div>
                                  <div className="export-item-desc">Print-ready</div>
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
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {selectedSchedule.instructions && (
                  <div className="schedule-instructions">
                    <p className="instructions-label">Custom instructions</p>
                    <p className="instructions-text">{selectedSchedule.instructions}</p>
                  </div>
                )}

                {selectedSchedule.data ? (
                  <>
                    <div className="schedule-filter-bar">
                      <div className="schedule-filter-label">
                        <Filter size={15} />
                        <span>Highlight</span>
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
                            Role
                          </button>
                          <button
                            type="button"
                            className={filterType === 'employee' ? 'active' : ''}
                            onClick={() => {
                              setFilterType('employee')
                              setFilterValue('')
                            }}
                          >
                            Person
                          </button>
                        </div>
                        <select
                          className="input schedule-filter-select"
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                        >
                          <option value="">
                            {filterType === 'role' ? 'All roles' : 'All people'}
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
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    <ScheduleTable
                      data={selectedSchedule.data}
                      employees={employees}
                      roles={roles}
                      onUpdate={handleScheduleUpdate}
                      highlightFilter={activeHighlightFilter}
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
                <p>Select a schedule from the list to view it.</p>
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
            <h3 className="modal-title">Delete this schedule?</h3>
            <p className="modal-text">
              This cannot be undone.
            </p>
            <div className="modal-actions">
              <button 
                className="secondary-button"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button 
                className="danger-button"
                onClick={() => handleDelete(confirmDelete)}
              >
                Delete
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
