import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2,
  BookOpen,
  Sparkles,
  Check,
  Clipboard,
  ClipboardCheck,
  RotateCw,
  Calendar,
  ArrowLeft,
  Download,
  FileText,
  Image,
} from 'lucide-react'
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  addDoc, 
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import ScheduleTable from '../components/ScheduleTable'
import { exportToCSV, exportToPNG, exportToPDF } from '../utils/exportSchedule'


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
  const [scheduleData, setScheduleData] = useState(null)
  const [exporting, setExporting] = useState(null) // null | 'csv' | 'png' | 'pdf'
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

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
    setScheduleData(null)
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
      
      // Parse the JSON response from Claude
      let parsed
      try {
        // Sometimes Claude wraps in markdown code blocks, strip them
        let cleanedText = data.schedule.trim()
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '')
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '')
        }
        parsed = JSON.parse(cleanedText)
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr)
        console.log('Raw response:', data.schedule)
        throw new Error('AI returned malformed schedule. Try regenerating.')
      }
      
      setScheduleData(parsed)
      setSchedule(data.schedule) // keep raw for save
      
      // Auto-save
      await saveSchedule(data.schedule, parsed)
      
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to generate schedule. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleScheduleUpdate(newData) {
    setScheduleData(newData)
    
    // Save updated data back to Firestore (update most recent schedule)
    try {
      const updatedText = JSON.stringify(newData, null, 2)
      setSchedule(updatedText)
      // We'll save a new version — simpler than tracking doc ID
      await saveSchedule(updatedText, newData)
    } catch (err) {
      console.error('Failed to save edits:', err)
    }
  }

  async function saveSchedule(scheduleText, parsedData) {
    try {
      await addDoc(collection(db, 'schedules'), {
        userId: currentUser.uid,
        weekStart: weekStart,
        content: scheduleText,
        data: parsedData || null,
        instructions: prompt || null,
        employeeCount: employees.length,
        createdAt: serverTimestamp()
      })
      setSaved(true)
    } catch (err) {
      console.error('Failed to save schedule:', err)
    }
  }

  async function handleExport(type) {
    if (!scheduleData) return
    setExporting(type)
    setExportMenuOpen(false)
    
    try {
      if (type === 'csv') {
        exportToCSV(scheduleData, weekStart)
      } else if (type === 'png') {
        await exportToPNG('schedule-export-target', weekStart)
      } else if (type === 'pdf') {
        await exportToPDF('schedule-export-target', weekStart)
      }
    } catch (err) {
      console.error('Export failed:', err)
      setError('Export failed. Try again.')
    } finally {
      setExporting(null)
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
          <p>Loading... <Loader2 size={16} className="spin" aria-hidden /></p>
        </div>
      </main>
    )
  }

  const openDaysCount = userSettings?.operatingHours
    ? Object.values(userSettings.operatingHours).filter(d => d.open).length
    : 0

  return (
    <main className="availability-page">
      <button onClick={() => navigate('/dashboard')} className="back-button">
  <ArrowLeft size={16} />
  <span>Back to dashboard</span>
</button>
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <BookOpen size={16} aria-hidden />
          <span>My Schedules</span>
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
        <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={20} aria-hidden />
          Which week?
        </h3>
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
            <>
              <Sparkles size={18} aria-hidden />
              <span>Generate Schedule</span>
            </>
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

{scheduleData && (
  <div className="availability-section schedule-output-section">
    <div className="schedule-header">
      <h3 className="section-title">Your Schedule</h3>
      <div className="schedule-actions">
  {saved && (
    <span className="saved-indicator">
      <Check size={14} />
      <span>Auto-saved</span>
    </span>
  )}
  
  {/* Export dropdown */}
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
          <button 
            className="export-dropdown-item"
            onClick={() => handleExport('csv')}
          >
            <FileText size={15} />
            <div>
              <div className="export-item-title">CSV (Excel)</div>
              <div className="export-item-desc">Open in spreadsheet apps</div>
            </div>
          </button>
          <button 
            className="export-dropdown-item"
            onClick={() => handleExport('png')}
          >
            <Image size={15} />
            <div>
              <div className="export-item-title">PNG Image</div>
              <div className="export-item-desc">Share screenshot</div>
            </div>
          </button>
          <button 
            className="export-dropdown-item"
            onClick={() => handleExport('pdf')}
          >
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
  
  <button 
    className="settings-button"
    onClick={() => {
      navigator.clipboard.writeText(JSON.stringify(scheduleData, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }}
  >
    {copied ? <ClipboardCheck size={16} /> : <Clipboard size={16} />}
    <span>{copied ? 'Copied' : 'Copy'}</span>
  </button>
  <button 
    className="settings-button"
    onClick={generateSchedule}
    disabled={generating}
  >
    <RotateCw size={16} />
    <span>Regenerate</span>
  </button>
</div>
    </div>
    
    <ScheduleTable 
  data={scheduleData}
  employees={employees}
  roles={userSettings?.roles || []}
  onUpdate={handleScheduleUpdate}
/>  </div>
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

function buildPrompt(employees, settings, customInstructions, weekStart) {
  const { operatingHours, coverage, preventClopening, minHoursBetweenShifts, roles } = settings
  
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  
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
- NEVER schedule someone outside their stated availability hours. If availability says NOT AVAILABLE or the shift falls outside their hours, do NOT schedule them.
- NEVER schedule someone during time-off dates that overlap with this week.
- If minimum coverage can't be met without violating availability, leave the gap and flag it.
- Try to get each person close to (but not over) their target hours per week.
- Distribute hours fairly across the team.
${preventClopening ? `- CLOPENING PREVENTION: Minimum ${minHoursBetweenShifts || 10} hours between shifts. Never violate.` : ''}
- Match employees to roles that fit the shift.

${customInstructions ? `\n## SPECIAL INSTRUCTIONS FROM MANAGER\n${customInstructions}\n` : ''}

## OUTPUT FORMAT — CRITICAL
You MUST respond with ONLY valid JSON, no markdown, no explanations before or after. Your entire response must be parseable as JSON.

Use this EXACT structure:

{
  "weekStart": "${weekStart}",
  "days": {
    "monday": {
      "date": "${dayDates.monday}",
      "shifts": [
        { "id": "m1", "employee": "Sam", "role": "Barista", "start": "06:00", "end": "14:00", "hours": 8 }
      ],
      "coverageGaps": []
    },
    "tuesday": { "date": "${dayDates.tuesday}", "shifts": [], "coverageGaps": [] },
    "wednesday": { "date": "${dayDates.wednesday}", "shifts": [], "coverageGaps": [] },
    "thursday": { "date": "${dayDates.thursday}", "shifts": [], "coverageGaps": [] },
    "friday": { "date": "${dayDates.friday}", "shifts": [], "coverageGaps": [] },
    "saturday": { "date": "${dayDates.saturday}", "shifts": [], "coverageGaps": [] },
    "sunday": { "date": "${dayDates.sunday}", "shifts": [], "coverageGaps": [] }
  },
  "summary": [
    { "employee": "Sam", "role": "Barista", "scheduledHours": 32, "targetHours": 30, "difference": 2 }
  ],
  "issues": [
    "Friday 18:00-21:00: coverage gap, no one available"
  ],
  "recommendations": [
    "Consider hiring one more cashier available in evenings"
  ]
}

RULES for the JSON:
- Times in 24-hour format "HH:MM"
- Each shift has a unique "id" (just use letters/numbers like "m1", "m2", "t1", etc.)
- "hours" = decimal hours worked (e.g. 8, 8.5)
- "difference" = scheduledHours - targetHours (can be negative)
- If no shifts on a day, shifts array is empty []
- If no coverage gaps, coverageGaps array is empty []
- "issues" is an array of short strings
- "recommendations" is an array of short strings
- NO markdown. NO explanations. ONLY the JSON object.

Generate the JSON schedule now.`
  
  return prompt
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default Schedule