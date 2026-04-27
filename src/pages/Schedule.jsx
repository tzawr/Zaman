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
  Users,
  Target,
  MessageSquare,
  Zap,
  GraduationCap,
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
import PageHero from '../components/PageHero'
import Section from '../components/Section'


const AI_EXAMPLES = [
  'Put Sam and Alex on the same shift every day this week',
  'Keep all shifts under 8 hours — everyone needs rest',
  'Alice is training a new hire — pair them on every shift',
  'Prioritize full-time staff for Friday and Saturday nights',
  'No one should work more than 5 days in a row',
]

const AI_UNDERSTANDS = [
  { icon: Users, text: 'Names & team relationships' },
  { icon: MessageSquare, text: 'Natural language rules' },
  { icon: Calendar, text: 'Dates & time-off exceptions' },
  { icon: Target, text: 'Hours, coverage & fairness' },
  { icon: GraduationCap, text: 'Training & mentoring situations' },
  { icon: Zap, text: 'Complex multi-step constraints' },
]

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
        parsed = enforceTargetHours(parsed, employees)
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
      <main className="app-page">
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
      <main className="app-page">
        <button 
          className="app-back-link"
          onClick={() => navigate('/dashboard')}
        >
          <ArrowLeft size={14} />
          <span>Back to dashboard</span>
        </button>
  
        <PageHero
          eyebrow="AI Scheduling"
          title="Generate schedule"
          subtitle="Pick a week, add any special rules, and let Zaman build your schedule in seconds."
        >
          <div className="page-hero-actions">
            <button 
              className="settings-button"
              onClick={() => navigate('/schedules')}
            >
              <BookOpen size={16} />
              <span>My schedules</span>
            </button>
          </div>
        </PageHero>

{/* Stats row */}
<div className="gen-stats">
  <div className="gen-stat">
    <Users size={18} />
    <div>
      <div className="gen-stat-value">{employees.length}</div>
      <div className="gen-stat-label">{employees.length === 1 ? 'person' : 'people'}</div>
    </div>
  </div>
  <div className="gen-stat">
    <Calendar size={18} />
    <div>
      <div className="gen-stat-value">{openDaysCount}</div>
      <div className="gen-stat-label">open days</div>
    </div>
  </div>
  <div className="gen-stat">
    <Target size={18} />
    <div>
      <div className="gen-stat-value">{userSettings?.roles?.length || 0}</div>
      <div className="gen-stat-label">roles</div>
    </div>
  </div>
</div>

{/* Week picker */}
<Section
  title="Which week?"
  subtitle="Pick the Monday of the week to schedule."
  icon={Calendar}
>
  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
    <input
      type="date"
      className="input gen-week-input"
      value={weekStart}
      onChange={(e) => setWeekStart(e.target.value)}
    />
    <div className="gen-week-preview">
      {formatWeekRange(weekStart)}
    </div>
  </div>
</Section>

{/* AI-powered special instructions */}
<div className="ai-instr-wrap">
  <div className="ai-instr-glow" aria-hidden />

  <div className="ai-instr-header">
    <div className="ai-instr-badge">
      <Sparkles size={11} />
      <span>Zaman AI</span>
    </div>
    <div>
      <h2 className="ai-instr-title">Special instructions</h2>
      <p className="ai-instr-subtitle">
        Describe anything in plain English — names, exceptions, relationships, preferences.
        Zaman reads it all and builds around it. No other scheduler can do this.
      </p>
    </div>
  </div>

  <textarea
    className="ai-instr-textarea"
    placeholder={`Try: "Alice is training a new hire this week — keep them together on every shift"\n\nOr: "Sam and Jordan can't work together. Give extra hours to full-time staff Friday."`}
    value={prompt}
    onChange={(e) => setPrompt(e.target.value)}
    rows={4}
  />

  <div className="ai-chip-row">
    <span className="ai-chip-label">Try an example:</span>
    {AI_EXAMPLES.map(ex => (
      <button
        key={ex}
        className="ai-chip"
        onClick={() => setPrompt(p => p ? p + '\n' + ex : ex)}
        type="button"
      >
        {ex}
      </button>
    ))}
  </div>

  <div className="ai-understands">
    <div className="ai-understands-label">What Zaman reads</div>
    <div className="ai-understands-grid">
      {AI_UNDERSTANDS.map(item => (
        <div key={item.text} className="ai-understands-item">
          <item.icon size={14} />
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  </div>
</div>

{/* Generate CTA */}
<div className="gen-cta-wrap">
  <div className="gen-cta-glow" aria-hidden />
  <button 
    className="generate-button gen-cta"
    onClick={generateSchedule}
    disabled={generating || employees.length === 0}
  >
    {generating ? (
      <>
        <Loader2 size={18} className="spin" />
        <span>Generating schedule...</span>
      </>
    ) : (
      <>
        <Sparkles size={18} />
        <span>Generate schedule</span>
      </>
    )}
  </button>
  {employees.length === 0 && (
    <p className="hint-text">
      <a onClick={() => navigate('/employees')}>Add team members</a> first.
    </p>
  )}
</div>

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
  const { operatingHours, coverage, preventClopening, minHoursBetweenShifts, roles, coverageRules } = settings
  
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

${coverageRules?.trim() ? `## COVERAGE REQUIREMENTS\n${coverageRules.trim()}` : ''}

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
- **ONE SHIFT PER PERSON PER DAY:** Each employee gets AT MOST ONE shift per day. No split shifts unless manager instructions explicitly request it.
- **TARGET HOURS:** Never schedule an employee for more total hours than their target for the week. Track their running total as you assign shifts. If adding a shift would push them over their target, do not assign them — treat them as ineligible for that slot.
- **MAXIMUM SHIFT LENGTH:** No single shift longer than 10 hours unless manager instructions say otherwise.
${preventClopening ? `- **CLOPENING:** Never schedule someone with less than ${minHoursBetweenShifts || 10} hours between a closing shift and the next day's opening.` : ''}
- Match employees to roles that fit the shift.
- If a coverage window has no eligible employee (unavailable, on time off, already at target hours, or already scheduled that day), leave it as an empty slot in "emptySlots" — do NOT assign an ineligible person.
- If the team is too small for coverage needs, say so in recommendations.

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
        { "id": "m1", "employee": "Sam", "role": "Barista", "start": "07:00", "end": "15:00", "hours": 8 }
      ],
      "emptySlots": []
    },
    "tuesday": { "date": "${dayDates.tuesday}", "shifts": [], "emptySlots": [] },
    "wednesday": { "date": "${dayDates.wednesday}", "shifts": [], "emptySlots": [] },
    "thursday": { "date": "${dayDates.thursday}", "shifts": [], "emptySlots": [] },
    "friday": {
      "date": "${dayDates.friday}",
      "shifts": [
        { "id": "f1", "employee": "Sam", "role": "Barista", "start": "07:00", "end": "15:00", "hours": 8 }
      ],
      "emptySlots": [
        { "start": "15:00", "end": "22:00", "role": "Cashier" }
      ]
    },
    "saturday": { "date": "${dayDates.saturday}", "shifts": [], "emptySlots": [] },
    "sunday": { "date": "${dayDates.sunday}", "shifts": [], "emptySlots": [] }
  },
  "summary": [
    { "employee": "Sam", "role": "Barista", "scheduledHours": 16, "targetHours": 20, "difference": -4 }
  ],
  "issues": [
    "Friday 15:00-22:00: no eligible staff"
  ],
  "recommendations": [
    "Consider hiring a part-time Cashier available Friday evenings"
  ]
}

RULES for the JSON:
- Times in 24-hour format "HH:MM"
- Each shift has a unique "id" (e.g. "m1", "t2")
- "hours" = decimal hours (e.g. 8, 8.5)
- "difference" = scheduledHours - targetHours (negative = under-scheduled)
- "emptySlots" = every coverage window you could not fill with an eligible employee. Each entry: { "start": "HH:MM", "end": "HH:MM", "role": "role name or empty string" }. A day can have both shifts AND emptySlots. Use [] when all coverage is met.
- "issues" is an array of short strings
- "recommendations" is an array of short strings
- NO markdown. NO explanations. ONLY the JSON object.

Generate the JSON schedule now.`
  
  return prompt
}
function shiftHours(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let h = (eh + em / 60) - (sh + sm / 60)
  if (h < 0) h += 24
  return Math.round(h * 10) / 10
}

// After the AI responds, enforce target-hour caps in JS.
// Any shift that would push an employee over their weekly target is removed
// and moved into emptySlots on that day so the gap is visible in the grid.
function enforceTargetHours(data, employees) {
  console.log('enforceTargetHours running', data)

  const targets = {}
  employees.forEach(emp => {
    if (emp.targetHours != null) targets[emp.name] = Number(emp.targetHours)
  })
  console.log('enforceTargetHours targets map', targets)

  const totals = {}
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

  DAYS.forEach(dayKey => {
    const day = data.days?.[dayKey]
    if (!day) return
    if (!Array.isArray(day.emptySlots)) day.emptySlots = []
    if (!Array.isArray(day.shifts)) day.shifts = []

    const kept = []
    day.shifts.forEach(shift => {
      const target = targets[shift.employee]
      if (target == null) { kept.push(shift); return }

      const soFar = totals[shift.employee] || 0
      const hrs = Number(shift.hours) || shiftHours(shift.start, shift.end)
      const newTotal = soFar + hrs

      if (newTotal <= target + 0.05) {
        kept.push(shift)
        totals[shift.employee] = newTotal
      } else {
        console.log('stripping shift for', shift.employee, 'hours would be', newTotal, 'target is', target)
        day.emptySlots.push({ start: shift.start, end: shift.end, role: shift.role || '' })
      }
    })
    day.shifts = kept
  })

  console.log('enforceTargetHours final totals', totals)
  return data
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default Schedule