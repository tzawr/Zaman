import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2,
  Sparkles,
  Rocket,
  Calendar,
  X,
  Clipboard,
  ClipboardCheck,
  ArrowLeft,
} from 'lucide-react'
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy,
  deleteDoc,
  doc
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useToast } from '../components/Toast'

function Schedules() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  
  const [schedules, setSchedules] = useState([])
  const [selectedSchedule, setSelectedSchedule] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

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
      <main className="availability-page">
        <div className="empty-state">
          <p>Loading schedules... <Loader2 size={16} className="spin" aria-hidden /></p>
        </div>
      </main>
    )
  }

  return (
    <main className="availability-page">
      <button onClick={() => navigate('/dashboard')} className="back-button">
  <ArrowLeft size={16} />
  <span>Back to dashboard</span>
</button>
      <div className="page-header employees-header">
        <div>
          <h2 className="page-title">My Schedules</h2>
          <p className="page-subtitle">
            All schedules you've generated. Click one to view.
          </p>
        </div>
        <button 
          className="generate-nav-button"
          onClick={() => navigate('/schedule')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <Sparkles size={18} aria-hidden />
          <span>Generate New</span>
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="empty-state">
          <p>
            {`No schedules yet. Click "Generate New" to create your first one `}
            <Rocket size={40} style={{ verticalAlign: 'middle', display: 'inline-block' }} aria-hidden />
          </p>
        </div>
      ) : (
        <div className="schedules-grid">
          {/* List of schedule cards */}
          <div className="schedule-list">
            {schedules.map(sched => (
              <div 
                key={sched.id}
                className={`schedule-card ${selectedSchedule?.id === sched.id ? 'selected' : ''}`}
                onClick={() => setSelectedSchedule(sched)}
              >
                <div className="schedule-card-header">
                  <p className="schedule-week" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Calendar size={20} aria-hidden />
                    <span>{formatWeekRange(sched.weekStart)}</span>
                  </p>
                  <button 
                    className="schedule-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDelete(sched.id)
                    }}
                    aria-label="Delete schedule"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
                <p className="schedule-meta">
                  Generated {formatCreatedAt(sched.createdAt)}
                </p>
                <p className="schedule-meta">
                  {sched.employeeCount || '?'} {sched.employeeCount === 1 ? 'person' : 'people'}
                  {sched.instructions && ' • With custom instructions'}
                </p>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          <div className="schedule-detail">
            {selectedSchedule ? (
              <>
                <div className="schedule-detail-header">
                  <div>
                    <h3 className="section-title no-margin">
                      {formatWeekRange(selectedSchedule.weekStart)}
                    </h3>
                    <p className="schedule-meta">
                      Generated {formatCreatedAt(selectedSchedule.createdAt)}
                    </p>
                  </div>
                  <button 
                    className="settings-button"
                    onClick={() => copyToClipboard(selectedSchedule.content)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    {copied ? (
                      <>
                        <ClipboardCheck size={16} aria-hidden />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Clipboard size={16} aria-hidden />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                
                {selectedSchedule.instructions && (
                  <div className="schedule-instructions">
                    <p className="instructions-label">Custom instructions:</p>
                    <p className="instructions-text">{selectedSchedule.instructions}</p>
                  </div>
                )}
                
                <div className="schedule-output">
                  <pre>{selectedSchedule.content}</pre>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <ArrowLeft size={20} aria-hidden />
                  <span>Select a schedule to view it.</span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
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

export default Schedules