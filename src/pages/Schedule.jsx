import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function Schedule() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  
  const [employees, setEmployees] = useState([])
  const [userSettings, setUserSettings] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [schedule, setSchedule] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) {
      navigate('/signin')
    }
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
    
    // Validation
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
      
      // Build the prompt for Claude
      const fullPrompt = buildPrompt(employees, userSettings, prompt)
      
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
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to generate schedule. Try again.')
    } finally {
      setGenerating(false)
    }
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
      <div className="page-header">
        <h2 className="page-title">Generate Schedule</h2>
        <p className="page-subtitle">
          Let Zaman build your weekly schedule based on everyone's availability.
        </p>
      </div>

      {/* Summary cards */}
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

      {/* Prompt box */}
      <div className="availability-section">
        <h3 className="section-title">Special Instructions</h3>
        <p className="section-subtitle">
          Any extra rules for this week? (Optional)
        </p>
        
        <textarea
          className="prompt-textarea"
          placeholder="e.g. 'Put Sam and Alex on the same shift Monday'&#10;'Don't schedule Jamie on Friday'&#10;'Prioritize coverage at morning rush (6-9am)'"
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
              🤖 Generate Schedule
            </>
          )}
        </button>
        
        {employees.length === 0 && (
          <p className="hint-text">
            Add team members on the <a onClick={() => navigate('/employees')}>employees page</a> first.
          </p>
        )}
      </div>

      {/* Error message */}
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
            <button 
              className="settings-button"
              onClick={generateSchedule}
              disabled={generating}
            >
              🔄 Regenerate
            </button>
          </div>
          <div className="schedule-output">
            <pre>{schedule}</pre>
          </div>
        </div>
      )}
    </main>
  )
}

// Helper: build the prompt from all the data
function buildPrompt(employees, settings, customInstructions) {
  const { operatingHours, coverage, preventClopening, minHoursBetweenShifts, roles } = settings
  
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  
  let prompt = `You are a professional scheduling assistant. Generate a weekly schedule for a small business team.

## OPERATING HOURS
${days.map(d => {
  const day = operatingHours[d]
  if (!day || !day.open) return `${capitalize(d)}: CLOSED`
  return `${capitalize(d)}: ${day.start} to ${day.end}`
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
- **NEVER schedule someone outside their stated availability hours.** This is an absolute rule. If availability says "NOT AVAILABLE" or the shift is outside their hours, DO NOT schedule them — leave the coverage gap and flag it.
- **NEVER schedule someone during their time-off dates.** Absolute rule.
- If minimum coverage can't be met without violating availability, leave the gap and flag it as "COVERAGE GAP — no one available." Do NOT fill it by violating someone's availability.
- Try to get each person close to (but not over) their target hours per week.
- Try to distribute hours fairly across the team.
${preventClopening ? `- **CLOPENING PREVENTION (strict):** Minimum ${minHoursBetweenShifts || 10} hours between end of one shift and start of next shift for any employee. Never violate.` : ''}
- Match employees to roles that fit the shift.
- If team capacity is fundamentally insufficient, provide a clear diagnosis at the end (e.g., "Need 2 more cashiers on Mondays").

${customInstructions ? `\n## SPECIAL INSTRUCTIONS FROM MANAGER\n${customInstructions}\n` : ''}

## OUTPUT FORMAT
For each day, list who works what hours. Format:

**Monday**
- Sam (Barista): 6:00 AM - 2:00 PM (8 hrs)
- Alex (Supervisor): 2:00 PM - 10:00 PM (8 hrs)
- COVERAGE GAP: No one available 10 PM - 11 PM [if applicable]

After the weekly schedule, provide:

### Weekly Summary
For each employee: total hours vs target (e.g., "Sam: 32 hrs / target 30 = +2 over")

### Schedule Issues
Any days where coverage minimums couldn't be met, explained with reasons.

### Recommendations
If the team is fundamentally understaffed or has availability gaps, say so clearly. Example: "You need 1 more Cashier available on Fridays" or "Consider reducing Monday coverage minimum to 2 people."

Generate the schedule now.`
  
  return prompt
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default Schedule