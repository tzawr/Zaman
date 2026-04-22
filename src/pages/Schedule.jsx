import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  addDoc, 
  serverTimestamp,
  orderBy
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function Schedule() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  
  const [employees, setEmployees] = useState([])
  const [userSettings, setUserSettings] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [weekStart, setWeekStart] = useState(getNextMonday())
  const [generating, setGenerating] = useState(false)
  const [schedule, setSchedule] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  // Load employees
  useEffect(() => {
    if (!currentUser) return
    
    const q = query(
      collection(db, 'employees'),
      where('userId', '==', currentUser.uid)
    )
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setEmployees(data)
    })
    
    return () => unsubscribe()
  }, [currentUser])

  // Load user settings
  useEffect(() => {
    if (!currentUser) return
    
    const unsubscribe = onSnapshot(doc(db, 'users', currentUser.uid), (snapshot) => {
      if (snapshot.exists()) {
        setUserSettings(snapshot.data())
        setLoading(false)
      }
    })
    
    return () => unsubscribe()
  }, [currentUser])

  async function generateSchedule() {
    setError('')
    setSchedule('')
    setSaved(false)
    setCopied(false)
    
    if (employees.length === 0) {
      setError('Add at least one employee before generating a schedule.')
      return
    }
    
    if (!userSettings?.operatingHours) {
      setError('Please set your operating hours in Settings first.')
      return
    }

    try {
      setGenerating(true)
      
      const fullPrompt = buildPrompt(employees, userSettings, prompt, weekStart)
      
      const response = await fetch('/api/generate-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt })
      })
      
      const data = await response.json()
      
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to generate schedule')
      }
      
      setSchedule(data.schedule)
      
      // Auto-save the generated schedule
      await saveSchedule(data.schedule)
      
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to generate schedule. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function saveSchedule(scheduleText) {
    try {
      await addDoc(collection(db, 'schedules'), {
        userId: currentUser.uid,
        weekStart: weekStart,
        content: scheduleText,
        instructions: prompt || null,
        employeeCount: employees.length,
        createdAt: serverTimestamp()
      })
      setSaved(true)
    } catch (err) {
      console.error('Failed to save schedule:', err)
    }
  }

  function copyToClipboard() {
    if (!schedule) return
    navigator.clipboard.writeText(schedule)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <main className="availability-page">
        <div className="empty-state">
          <p>Loading... ⏳</p>
        </div>
      </main>
    )
  }

  const openDaysCount = userSettings?.operatingHours
    ? Object.values(userSettings.operatingHours).filter(d => d.open).length
    : 0

  return (
    <main className="availability-page">
      <div className="page-header employees-header">
        <div>
          <h2 className="page-title">Generate Schedule</h2>
          <p className="page-subtitle">
            Let Zaman build your weekly schedule based on availability.
          </p>
        </div>
        <button 
          className="settings-button"
          onClick={() => navigate('/schedules')}
        >
          📚 My Schedules
        </button>
      </div>

      {/* Summary */}
      <div className="summary-cards">
        <div className="summary-card">
          <p className="summary-label">Team</p>
          <p className="summary-value">{employees.length}</p>
          <p className="summary-sublabel">
            {employees.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <div className="summary-card">
          <p className="summary-label">Open Days</p>
          <p className="summary-value">{openDaysCount}</p>
          <p className="summary-sublabel">per week</p>
        </div>
        <div className="summary-card">
          <p className="summary-label">Roles</p>
          <p className="summary-value">{userSettings?.roles?.length || 0}</p>
          <p className="summary-sublabel">configured</p>
        </div>
      </div>

      {/* Week picker */}
      <div className="availability-section">
        <h3 className="section-title">Which week?</h3>
        <p className="section-subtitle">
          Pick the Monday of the week you want to schedule.
        </p>
        
        <div className="week-picker-row">
          <input
            type="date"
            className="input week-picker"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
          />
          <div className="week-preview">
            {formatWeekRange(weekStart)}
          </div>
        </div>
      </div>

      {/* Special instructions */}
      <div className="availability-section">
        <h3 className="section-title">Special Instructions (optional)</h3>
        <p className="section-subtitle">
          Any extra rules for this week?
        </p>
        
        <textarea
          className="prompt-textarea"
          placeholder="e.g. 'Put Sam and Alex together on Monday'&#10;'Keep shifts under 8 hours this week'&#10;'Alice is training a new hire on Tuesday'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
        />
      </div>

      {/* Generate button */}
      <div className="generate-section">
        <button 
          className="generate-button"
          onClick={generateSchedule}
          disabled={generating || employees.length === 0}
        >
          {generating ? (
            <>
              <span className="spinner"></span>
              Generating schedule...
            </>
          ) : (
            <>🤖 Generate Schedule</>
          )}
        </button>
        
        {employees.length === 0 && (
          <p className="hint-text">
            Add team members on the <a onClick={() => navigate('/employees')}>employees page</a> first.
          </p>
        )}
      </div>

      {error && (
        <div className="auth-error" style={{ marginTop: '20px' }}>
          {error}
        </div>
      )}

      {/* Schedule output */}
      {schedule && (
        <div className="availability-section">
          <div className="schedule-header">
            <h3 className="section-title">Your Schedule</h3>
            <div className="schedule-actions">
              {saved && (
                <span className="saved-indicator">✓ Auto-saved</span>
              )}
              <button 
                className="settings-button"
                onClick={copyToClipboard}
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
              <button 
                className="settings-button"
                onClick={generateSchedule}
                disabled={generating}
              >
                🔄 Regenerate
              </button>
            </div>
          </div>
          <div className="schedule-output">
            <pre>{schedule}</pre>
          </div>
        </div>
      )}
    </main>
  )
}

// Helper: Get next Monday in YYYY-MM-DD format
function getNextMonday() {
  const today = new Date()
  const day = today.getDay()
  const daysUntilMonday = day === 0 ? 1 : (8 - day) % 7 || 7
  const nextMonday = new Date(today)
  nextMonday.setDate(today.getDate() + daysUntilMonday)
  return nextMonday.toISOString().split('T')[0]
}

// Helper: format week range for display
function formatWeekRange(mondayStr) {
  if (!mondayStr) return ''
  const monday = new Date(mondayStr + 'T12:00:00')
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  
  const format = (d) => d.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  })
  
  return `${format(monday)} — ${format(sunday)}, ${monday.getFullYear()}`
}

// Helper: compute date for a given day of week relative to weekStart
function getDateForDay(weekStart, dayIndex) {
  const monday = new Date(weekStart + 'T12:00:00')
  const date = new Date(monday)
  date.setDate(monday.getDate() + dayIndex)
  return date.toISOString().split('T')[0]
}

// Build the prompt from all the data
function buildPrompt(employees, settings, customInstructions, weekStart) {
  const { operatingHours, coverage, preventClopening, minHoursBetweenShifts, roles } = settings
  
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  
  // Map days to actual dates
  const dayDates = {}
  days.forEach((d, i) => {
    dayDates[d] = getDateForDay(weekStart, i)
  })
  
  let prompt = `You are a professional scheduling assistant. Generate a weekly schedule for a small business team.

## THIS SCHEDULE IS FOR
Week of ${weekStart} (Monday) through ${getDateForDay(weekStart, 6)} (Sunday).

## OPERATING HOURS
${days.map(d => {
  const day = operatingHours[d]
  const date = dayDates[d]
  if (!day || !day.open) return `${capitalize(d)} (${date}): CLOSED`
  return `${capitalize(d)} (${date}): ${day.start} to ${day.end}`
}).join('\n')}

## COVERAGE REQUIREMENTS
${days.map(d => {
  const day = operatingHours[d]
  if (!day || !day.open) return `${capitalize(d)}: N/A (closed)`
  const min = coverage?.[d]?.minPeople || 1
  return `${capitalize(d)}: minimum ${min} ${min === 1 ? 'person' : 'people'} at all times`
}).join('\n')}

## ROLES
${roles?.map(r => `- ${r.name}`).join('\n') || 'No roles defined'}

## EMPLOYEES
${employees.map(emp => {
  const targetHrs = emp.targetHours !== undefined ? emp.targetHours : 'not specified'
  let empInfo = `\n### ${emp.name} (${emp.role}, target: ${targetHrs} hrs/week)\n`
  
  if (emp.availability) {
    empInfo += 'Availability:\n'
    days.forEach(d => {
      const day = emp.availability[d]
      if (!day) {
        empInfo += `  ${capitalize(d)}: not set\n`
      } else if (!day.available) {
        empInfo += `  ${capitalize(d)}: NOT AVAILABLE\n`
      } else {
        empInfo += `  ${capitalize(d)}: ${day.start} to ${day.end}\n`
      }
    })
  } else {
    empInfo += 'Availability: not set\n'
  }
  
  if (emp.timeOff && emp.timeOff.length > 0) {
    empInfo += 'Time off requests:\n'
    emp.timeOff.forEach(t => {
      empInfo += `  - ${t.start} to ${t.end} (${t.reason || 'time off'})\n`
    })
  }
  
  return empInfo
}).join('\n')}

## SCHEDULING RULES (STRICT — NEVER VIOLATE)
- **NEVER schedule someone outside their stated availability hours.** If availability says NOT AVAILABLE or the shift falls outside their hours, do NOT schedule them. Leave the gap and flag it.
- **NEVER schedule someone during time-off dates that overlap with this week** (${weekStart} to ${getDateForDay(weekStart, 6)}).
- If minimum coverage can't be met without violating availability, leave the gap and flag it as "COVERAGE GAP — no one available." Do not fill gaps by breaking rules.
- Try to get each person close to (but not over) their target hours per week.
- Distribute hours fairly across the team.
${preventClopening ? `- **CLOPENING PREVENTION:** Minimum ${minHoursBetweenShifts || 10} hours between end of one shift and start of next shift for any employee. Never violate.` : ''}
- Match employees to roles that fit the shift.

${customInstructions ? `\n## SPECIAL INSTRUCTIONS FROM MANAGER\n${customInstructions}\n` : ''}

## OUTPUT FORMAT
For each day, list who works what hours. Format:

**Monday — ${dayDates.monday}**
- Sam (Barista): 6:00 AM - 2:00 PM (8 hrs)
- Alex (Supervisor): 2:00 PM - 10:00 PM (8 hrs)

After the weekly schedule, provide:

### Weekly Summary
Total hours per employee vs target.

### Schedule Issues
Any coverage gaps, with reasons.

### Recommendations
If team is fundamentally understaffed or has availability gaps, say so clearly with specific suggestions.

Generate the schedule now.`
  
  return prompt
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default Schedule