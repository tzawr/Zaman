import { useState, useEffect, useRef, useCallback } from 'react'
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
  Mic,
  MicOff,
} from 'lucide-react'
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  getDocs,
  doc, 
  addDoc, 
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import ScheduleTable from '../components/ScheduleTable'
import { exportToCSV, exportToPNG, exportToPDF } from '../utils/exportSchedule'
import { runScheduler } from '../utils/scheduler'
import { useSpeechInput } from '../utils/useSpeechInput'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

function Schedule() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { t, language } = useI18n()
  const generationSeedRef = useRef(0)
  
  const [employees, setEmployees] = useState([])
  const [userSettings, setUserSettings] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [weekStart, setWeekStart] = useState(getNextMonday())
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [scheduleData, setScheduleData] = useState(null)
  const [exporting, setExporting] = useState(null) // null | 'csv' | 'png' | 'pdf'
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const specialSpeech = useSpeechInput((text) => {
    setPrompt(prev => prev ? `${prev.trim()}\n${text}` : text)
  })

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  const mergeEmployeePortalAvailability = useCallback(async (team) => {
    if (!currentUser || team.length === 0) return team
    try {
      const portalQuery = query(
        collection(db, 'users'),
        where('managerId', '==', currentUser.uid),
        where('accountType', '==', 'employee')
      )
      const portalSnap = await getDocs(portalQuery)
      const portalByEmployeeId = new Map()
      portalSnap.docs.forEach(portalDoc => {
        const data = portalDoc.data()
        if (data.linkedEmployeeId) portalByEmployeeId.set(data.linkedEmployeeId, data)
      })
      return team.map(emp => {
        const portal = portalByEmployeeId.get(emp.id)
        if (!portal) return emp
        return {
          ...emp,
          availability: portal.availability || emp.availability,
          timeOff: portal.timeOff || emp.timeOff,
          availabilityUpdatedAt: portal.availabilityUpdatedAt || emp.availabilityUpdatedAt,
          availabilityUpdatedByType: portal.availabilityUpdatedByType || emp.availabilityUpdatedByType,
        }
      })
    } catch {
      return team
    }
  }, [currentUser])

  // Load employees
  useEffect(() => {
    if (!currentUser) return

    const q = query(
      collection(db, 'employees'),
      where('userId', '==', currentUser.uid)
    )

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setEmployees(await mergeEmployeePortalAvailability(data))
    })

    return () => unsubscribe()
  }, [currentUser, mergeEmployeePortalAvailability])

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
    setScheduleData(null)
    setSaved(false)
    setCopied(false)

    if (employees.length === 0) {
      setError(t('scheduleNeedEmployee'))
      return
    }

    if (!userSettings?.operatingHours) {
      setError(t('scheduleNeedHours'))
      return
    }

    try {
      setGenerating(true)
      const schedulingEmployees = await mergeEmployeePortalAvailability(employees)

      // Step 1: Parse both coverage rules and special instructions into structured constraints (AI, cached)
      const parsedRules = enhanceParsedRules(
        await parseSchedulingInstructionsCached(userSettings.coverageRules, prompt),
        prompt,
        schedulingEmployees
      )

      // Step 2: Build deterministic constraints from structured rules
      const constraints = buildConstraintsFromParsedRules(parsedRules, userSettings.operatingHours)

      // Step 3: Try several deterministic variants and keep the cleanest one.
      let best = null
      generationSeedRef.current += 1
      const baseSeed = hashScheduleSeed(weekStart, prompt, generationSeedRef.current)
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = runScheduler(schedulingEmployees, userSettings, weekStart, {
          ...constraints,
          seed: baseSeed + attempt,
        })
        const violations = validateSchedule(candidate, schedulingEmployees, parsedRules)
        const score = scoreScheduleCandidate(candidate, violations, schedulingEmployees, parsedRules?.employeeRules)
        if (!best || score < best.score) {
          best = { result: candidate, violations, score }
        }
        if (score === 0) break
      }

      // Step 4: Validate and surface any unsatisfied constraints as issues
      const result = best.result
      result.summary = calculateScheduleSummary(result, schedulingEmployees)
      if (best.violations.length > 0) {
        console.warn('[scheduler] violations:', best.violations)
        result.issues = best.violations
        result.recommendations = await generateScheduleRecommendations(result, best.violations, schedulingEmployees)
      }

      // Step 5: Save and display
      const finalText = JSON.stringify(result, null, 2)
      setScheduleData(result)
      await saveSchedule(finalText, result)

    } catch (err) {
      console.error(err)
      setError(err.message || t('scheduleFailedGenerate'))
    } finally {
      setGenerating(false)
    }
  }

  async function handleScheduleUpdate(newData) {
    setScheduleData(newData)
    
    // Save updated data back to Firestore (update most recent schedule)
    try {
      const updatedText = JSON.stringify(newData, null, 2)
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
    if (!activeScheduleData) return
    setExporting(type)
    setExportMenuOpen(false)
    
    try {
      if (type === 'csv') {
        exportToCSV(activeScheduleData, weekStart)
      } else if (type === 'png') {
        await exportToPNG('schedule-export-target', weekStart)
      } else if (type === 'pdf') {
        await exportToPDF('schedule-export-target', weekStart)
      }
    } catch (err) {
      console.error('Export failed:', err)
      setError(t('exportFailed'))
    } finally {
      setExporting(null)
    }
  }

  if (loading) {
    return (
      <main className="app-page">
        <div className="empty-state">
          <p>{t('loading')} <Loader2 size={16} className="spin" aria-hidden /></p>
        </div>
      </main>
    )
  }

  const openDaysCount = userSettings?.operatingHours
    ? Object.values(userSettings.operatingHours).filter(d => d.open).length
    : 0
  const activeScheduleData = scheduleData ? withFreshSummary(scheduleData, employees) : null

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
          eyebrow={t('aiScheduling')}
          title={t('generateSchedule')}
          subtitle={t('scheduleBuilderSubtitle')}
        >
          <div className="page-hero-actions">
            <button 
              className="settings-button"
              onClick={() => navigate('/schedules')}
            >
              <BookOpen size={16} />
              <span>{t('mySchedules')}</span>
            </button>
          </div>
        </PageHero>

{/* Stats row */}
<div className="gen-stats">
  <div className="gen-stat">
    <Users size={18} />
    <div>
      <div className="gen-stat-value">{employees.length}</div>
      <div className="gen-stat-label">{employees.length === 1 ? t('person') : t('people')}</div>
    </div>
  </div>
  <div className="gen-stat">
    <Calendar size={18} />
    <div>
      <div className="gen-stat-value">{openDaysCount}</div>
      <div className="gen-stat-label">{t('openDays')}</div>
    </div>
  </div>
  <div className="gen-stat">
    <Target size={18} />
    <div>
      <div className="gen-stat-value">{userSettings?.roles?.length || 0}</div>
      <div className="gen-stat-label">{t('roles')}</div>
    </div>
  </div>
</div>

{/* Week picker */}
<Section
  title={t('whichWeek')}
  subtitle={t('whichWeekSubtitle')}
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
      {formatWeekRange(weekStart, language)}
    </div>
  </div>
</Section>

{/* AI-powered special instructions */}
<div className="ai-instr-wrap">
  <div className="ai-instr-glow" aria-hidden />

  <div className="ai-instr-header">
    <div className="ai-instr-heading">
      <div className="ai-instr-badge">
        <Sparkles size={11} />
        <span>{t('hengamAi')}</span>
      </div>
      <h2 className="ai-instr-title">{t('specialInstructions')}</h2>
      <p className="ai-instr-subtitle">
        {t('specialInstructionsSubtitle')}
      </p>
    </div>
  </div>

  <div className="instruction-editor">
    <div className="instruction-toolbar">
      <div className="instruction-toolbar-copy">
        <Mic size={15} />
        <span>{t('speakManagerNotes')}</span>
      </div>
      {specialSpeech.supported ? (
        <button
          type="button"
          className={`voice-button voice-button-premium ${specialSpeech.listening ? 'listening' : ''}`}
          onClick={specialSpeech.toggleListening}
          title={specialSpeech.listening ? t('stopDictation') : t('dictateInstructions')}
        >
          <span className="voice-dot" aria-hidden />
          {specialSpeech.listening ? <MicOff size={16} /> : <Mic size={16} />}
          <span>{specialSpeech.listening ? t('listening') : t('startDictation')}</span>
        </button>
      ) : (
        <span className="voice-unavailable">{t('voiceUnavailable')}</span>
      )}
    </div>
    <textarea
      className="ai-instr-textarea"
      placeholder={t('specialInstructionsPlaceholder')}
      value={prompt}
      onChange={(e) => setPrompt(e.target.value)}
      rows={4}
    />
  </div>

  <div className="ai-chip-row">
    <span className="ai-chip-label">{t('tryExample')}</span>
    {['aiExample1', 'aiExample2', 'aiExample3', 'aiExample4', 'aiExample5'].map(key => {
      const ex = t(key)
      return (
      <button
        key={ex}
        className="ai-chip"
        onClick={() => setPrompt(p => p ? p + '\n' + ex : ex)}
        type="button"
      >
        {ex}
      </button>
      )
    })}
  </div>

  <div className="ai-understands">
    <div className="ai-understands-label">{t('whatHengamReads')}</div>
    <div className="ai-understands-grid">
      {[
        { icon: Users, key: 'aiReadsNames' },
        { icon: MessageSquare, key: 'aiReadsRules' },
        { icon: Calendar, key: 'aiReadsDates' },
        { icon: Target, key: 'aiReadsHours' },
        { icon: GraduationCap, key: 'aiReadsTraining' },
        { icon: Zap, key: 'aiReadsComplex' },
      ].map(item => {
        const Icon = item.icon
        return (
        <div key={item.key} className="ai-understands-item">
          <Icon size={14} />
          <span>{t(item.key)}</span>
        </div>
        )
      })}
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
        <span>{t('generatingSchedule')}</span>
      </>
    ) : (
      <>
        <Sparkles size={18} />
        <span>{t('generateSchedule')}</span>
      </>
    )}
  </button>
  {employees.length === 0 && (
    <p className="hint-text">
      <a onClick={() => navigate('/employees')}>{t('addTeamMembers')}</a> {t('addTeamFirstSuffix')}
    </p>
  )}
  {error && <p className="hint-text">{error}</p>}
</div>

{activeScheduleData && (
  <div className="schedule-output-section">
    <div className="schedule-result-bar">
      <div className="schedule-result-bar-left">
        <span className="schedule-result-ready">
          <Check size={13} />
          {saved ? t('saved') : t('ready')}
        </span>
        <span className="schedule-result-week">{formatWeekRange(weekStart, language)}</span>
      </div>

      <div className="schedule-result-actions">
        <button
          className="schedule-result-btn"
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(activeScheduleData, null, 2))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? <ClipboardCheck size={15} /> : <Clipboard size={15} />}
          <span>{copied ? t('copied') : t('copy')}</span>
        </button>

        <button
          className="schedule-result-btn"
          onClick={generateSchedule}
          disabled={generating}
        >
          <RotateCw size={15} />
          <span>{t('regenerate')}</span>
        </button>

        <div className="export-dropdown-wrap">
          <button
            className="schedule-result-btn schedule-result-btn-primary"
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            disabled={exporting !== null}
          >
            {exporting ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            <span>{exporting ? `${t('exporting')}...` : t('export')}</span>
          </button>
          {exportMenuOpen && (
            <>
              <div className="export-dropdown-backdrop" onClick={() => setExportMenuOpen(false)} />
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
      </div>
    </div>

    <ScheduleTable
      data={activeScheduleData}
      employees={employees}
      roles={userSettings?.roles || []}
      onUpdate={handleScheduleUpdate}
    />
  </div>
)}
    </main>
  )
}

function withFreshSummary(schedule, employees) {
  return {
    ...schedule,
    summary: calculateScheduleSummary(schedule, employees),
  }
}

function calculateScheduleSummary(schedule, employees) {
  const totals = {}

  Object.values(schedule?.days || {}).forEach(day => {
    ;(day.shifts || []).forEach(shift => {
      const hours = Number(shift.hours) || shiftHours(shift.start, shift.end)
      totals[shift.employee] = (totals[shift.employee] || 0) + hours
    })
  })

  const employeeRows = employees.map(emp => {
    const scheduled = Math.round((totals[emp.name] || 0) * 10) / 10
    const target = Number(emp.targetHours) || 0
    delete totals[emp.name]
    return {
      employee: emp.name,
      role: emp.role || '',
      scheduledHours: scheduled,
      targetHours: target,
      difference: Math.round((scheduled - target) * 10) / 10,
    }
  })

  const unknownRows = Object.entries(totals).map(([employee, total]) => {
    const scheduled = Math.round(total * 10) / 10
    return {
      employee,
      role: '',
      scheduledHours: scheduled,
      targetHours: 0,
      difference: scheduled,
    }
  })

  return [...employeeRows, ...unknownRows]
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
function formatWeekRange(mondayStr, language = 'en') {
  if (!mondayStr) return ''
  const monday = new Date(mondayStr + 'T12:00:00')
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  
  const locale = language === 'fa' ? 'fa-IR' : 'en-US'
  const format = (d) => d.toLocaleDateString(locale, {
    month: 'short', 
    day: 'numeric' 
  })
  
  return `${format(monday)} — ${format(sunday)}, ${monday.getFullYear()}`
}

function hashScheduleSeed(weekStart, prompt, counter) {
  const input = `${weekStart}|${prompt || ''}|${counter}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function scoreScheduleCandidate(schedule, violations, employees, employeeRules = null) {
  let score = violations.length * 1000
  const shiftsByEmployee = {}
  const shiftsByDay = {}

  Object.entries(schedule.days || {}).forEach(([dayKey, day]) => {
    shiftsByDay[dayKey] = day.shifts || []
    ;(day.shifts || []).forEach(shift => {
      if (!shiftsByEmployee[shift.employee]) shiftsByEmployee[shift.employee] = []
      shiftsByEmployee[shift.employee].push(shift)
    })
  })

  ;(schedule.summary || []).forEach(row => {
    const target = Number(row.targetHours) || 0
    const diff = Math.abs(Number(row.difference) || 0)
    score += diff * 80

    const shifts = shiftsByEmployee[row.employee] || []
    const idealDays = target > 0 ? Math.ceil(target / 8) : shifts.length
    const extraDays = Math.max(0, shifts.length - idealDays)
    score += extraDays * 25

    if (target >= 24) {
      shifts.forEach(shift => {
        const hours = Number(shift.hours) || 0
        if (hours > 0 && hours < 7) score += (7 - hours) * 8
      })
    }

    const employee = employees.find(emp => emp.name === row.employee)
    if (employee && Number(row.difference) < -0.05) {
      const workedDays = new Set(shifts.map(shift => findShiftDay(schedule, shift)))
      const unusedAvailableDays = Object.entries(employee.availability || {}).filter(([dayKey, av]) =>
        av &&
        av.available !== false &&
        schedule.days?.[dayKey]?.shifts &&
        !workedDays.has(dayKey)
      ).length
      score += unusedAvailableDays * Math.abs(Number(row.difference) || 0) * 30
    }
  })

  if (employeeRules) {
    ;(employeeRules.pairTogether || []).forEach(([a, b]) => {
      Object.values(shiftsByDay).forEach(shifts => {
        const hasA = shifts.some(s => s.employee === a)
        const hasB = shifts.some(s => s.employee === b)
        if (hasA !== hasB) score += 900
        if (hasA && hasB && !pairedShiftsOverlap(shifts, a, b)) score += 250
      })
    })

    ;(employeeRules.avoidTogether || []).forEach(([a, b]) => {
      Object.values(shiftsByDay).forEach(shifts => {
        const aShifts = shifts.filter(s => s.employee === a)
        const bShifts = shifts.filter(s => s.employee === b)
        if (aShifts.some(aShift => bShifts.some(bShift => shiftsOverlap(aShift, bShift)))) {
          score += 900
        }
      })
    })

    Object.entries(employeeRules.shiftHoursByEmployee || {}).forEach(([employee, hours]) => {
      ;(shiftsByEmployee[employee] || []).forEach(shift => {
        score += Math.abs((Number(shift.hours) || 0) - Number(hours)) * 500
      })
    })
  }

  return score
}

function findShiftDay(schedule, targetShift) {
  for (const [dayKey, day] of Object.entries(schedule.days || {})) {
    if ((day.shifts || []).includes(targetShift)) return dayKey
  }
  return ''
}

async function callGenerateAPI(prompt) {
  const resp = await fetch('/api/generate-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!resp.ok) {
    const err = await resp.json()
    throw new Error(err.error || 'Schedule generation failed')
  }
  const data = await resp.json()
  return data.scheduleText || ''
}

async function generateScheduleRecommendations(schedule, violations, employees) {
  if (!violations?.length) return []

  const summary = (schedule.summary || [])
    .filter(row => Math.abs(Number(row.difference) || 0) > 0.05)
    .map(row => `${row.employee}: ${row.scheduledHours}/${row.targetHours}h (${row.difference}h)`)
    .join('\n')

  const prompt = `You are advising a small-business shift manager after an automated schedule draft.
Write 3-5 short, professional recommendations based on these schedule issues.
Do not blame the manager. Be specific and business-oriented.
Mention practical actions like adjusting availability, changing target hours, adding coverage, or hiring/training for a role.
Output ONLY a JSON array of strings.

SCHEDULE ISSUES:
${violations.slice(0, 12).map((v, i) => `${i + 1}. ${v}`).join('\n')}

HOUR SUMMARY GAPS:
${summary || 'No hour gaps.'}

TEAM:
${employees.map(emp => `${emp.name} | ${emp.role || 'No role'} | target ${emp.targetHours ?? 0}h`).join('\n')}`

  try {
    const text = await callGenerateAPI(prompt)
    let clean = text.trim()
    if (clean.startsWith('```json')) clean = clean.replace(/^```json\n?/, '').replace(/\n?```$/, '')
    else if (clean.startsWith('```')) clean = clean.replace(/^```\n?/, '').replace(/\n?```$/, '')
    const first = clean.indexOf('[')
    const last = clean.lastIndexOf(']')
    if (first === -1 || last === -1) return fallbackRecommendations(violations)
    const parsed = JSON.parse(clean.slice(first, last + 1))
    return Array.isArray(parsed) ? parsed.slice(0, 5).map(String) : fallbackRecommendations(violations)
  } catch {
    return fallbackRecommendations(violations)
  }
}

function fallbackRecommendations(violations) {
  const text = violations.join(' ').toLowerCase()
  const recommendations = []
  if (text.includes('opening')) {
    recommendations.push('Review early-morning availability for employees who can legally and practically open the business.')
  }
  if (text.includes('closing') || text.includes('pre-closer')) {
    recommendations.push('Check whether enough trained employees are available through closing and consider training one additional closer.')
  }
  if (text.includes('target')) {
    recommendations.push('Compare each target-hour goal against the employee’s actual availability before publishing the schedule.')
  }
  if (text.includes('staff from')) {
    recommendations.push('For understaffed windows, either add one eligible employee or lower the minimum coverage requirement for that period.')
  }
  if (recommendations.length === 0) {
    recommendations.push('Review the highlighted items before publishing and adjust coverage rules or employee availability as needed.')
  }
  return recommendations.slice(0, 5)
}

function enhanceParsedRules(parsedRules, specialInstructions, employees) {
  const heuristicRules = parseLocalInstructionHints(specialInstructions, employees)
  if (!heuristicRules) return parsedRules

  const next = parsedRules
    ? JSON.parse(JSON.stringify(parsedRules))
    : {}
  next.employeeRules = next.employeeRules || {}

  if (heuristicRules.pairTogether?.length) {
    const existing = next.employeeRules.pairTogether || []
    heuristicRules.pairTogether.forEach(pair => {
      if (!existing.some(current => samePair(current, pair))) existing.push(pair)
    })
    next.employeeRules.pairTogether = existing
  }

  if (heuristicRules.shiftHoursByEmployee) {
    next.employeeRules.shiftHoursByEmployee = {
      ...(next.employeeRules.shiftHoursByEmployee || {}),
      ...heuristicRules.shiftHoursByEmployee,
    }
  }

  return next
}

function parseLocalInstructionHints(text, employees) {
  if (!text?.trim() || !employees?.length) return null

  const rules = { pairTogether: [], shiftHoursByEmployee: {} }
  const sentences = text
    .split(/[\n.!?]+/)
    .map(s => s.trim())
    .filter(Boolean)

  sentences.forEach(sentence => {
    const lower = sentence.toLowerCase()
    const mentioned = employees
      .filter(emp => lower.includes(emp.name.toLowerCase()))
      .map(emp => emp.name)

    if (mentioned.length >= 2 && /\b(together|same shift|training|train)\b/i.test(sentence)) {
      const pair = [mentioned[0], mentioned[1]]
      if (!rules.pairTogether.some(current => samePair(current, pair))) rules.pairTogether.push(pair)
    }

    mentioned.forEach(name => {
      const numberMatch = sentence.match(/\b(\d+(?:\.\d+)?)\s*(?:-| )?hour\b/i)
      const wordFour = /\bfour\s*(?:-| )?hour\b/i.test(sentence)
      const wantsShortShift = /\b(short|shorter|half)\b/i.test(sentence) && /\bshift/i.test(sentence)
      const hours = numberMatch ? Number(numberMatch[1]) : wordFour || wantsShortShift ? 4 : null
      if (hours && hours >= 4 && hours <= 8.5 && /\bshift/i.test(sentence)) {
        rules.shiftHoursByEmployee[name] = hours
      }
    })
  })

  if (!rules.pairTogether.length && Object.keys(rules.shiftHoursByEmployee).length === 0) return null
  return rules
}

function samePair(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length >= 2 &&
    b.length >= 2 &&
    ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]))
}

async function parseSchedulingInstructionsCached(coverageRulesText, specialInstructions) {
  const combined = (coverageRulesText || '').trim() + '\n---\n' + (specialInstructions || '').trim()
  if (!combined.replace(/---/g, '').trim()) return null
  let hash = 0
  for (let i = 0; i < combined.length; i++) hash = (Math.imul(31, hash) + combined.charCodeAt(i)) | 0
  const key = 'hengam_rules_v3_' + Math.abs(hash)
  try {
    const cached = localStorage.getItem(key)
    if (cached) return JSON.parse(cached)
  } catch {
    // Ignore cache read errors.
  }
  const result = await parseSchedulingInstructions(coverageRulesText, specialInstructions)
  if (result) {
    try { localStorage.setItem(key, JSON.stringify(result)) } catch {
      // Ignore cache write errors.
    }
  }
  return result
}

async function parseSchedulingInstructions(coverageRulesText, specialInstructions) {
  const hasCoverage = coverageRulesText?.trim()
  const hasInstructions = specialInstructions?.trim()
  if (!hasCoverage && !hasInstructions) return null

  const inputBlock = [
    hasCoverage ? `COVERAGE RULES:\n${coverageRulesText.trim()}` : '',
    hasInstructions ? `SPECIAL INSTRUCTIONS:\n${specialInstructions.trim()}` : '',
  ].filter(Boolean).join('\n\n')

  const aiPrompt = `Parse the following scheduling rules into structured JSON. Output ONLY valid JSON, no explanation.

${inputBlock}

Return a JSON object. Omit any fields not mentioned or implied:
{
  "coverage": {
    "openers": {
      "by": "04:30",
      "composition": [{"role": "Shift Supervisor", "count": 1}, {"role": "Barista", "count": 1}]
    },
    "closers": {
      "shiftEnd": "20:30",
      "composition": [{"role": "Shift Supervisor", "count": 1}, {"role": "Barista", "count": 1}]
    },
    "preCloser": {"count": 1, "roles": ["Role"], "shiftEnd": "20:00"},
    "alwaysPresent": ["Shift Supervisor"],
    "minimumStaff": [{"from": "08:00", "to": "12:00", "count": 3}]
  },
  "employeeRules": {
    "pairTogether": [["Alice", "Jordan"]],
    "avoidTogether": [["Sam", "Rae"]],
    "maxDays": {"Nura": 5},
    "maxCloses": {"Nura": 2},
    "preferShiftWindows": {"Isabel": {"start": "04:00", "end": "12:00"}},
    "shiftHoursByEmployee": {"Amir": 4},
    "trainingPairs": [{"trainee": "New Hire", "mentorRole": "Shift Supervisor"}],
    "preferredEmployeesByDay": {"friday": ["Sam", "Alex"]}
  }
}

Field meanings:
- Coverage counts are MINIMUMS unless the text explicitly says "exactly" or "only".
- If the text says "we need 2 people at 4am" with no roles, use coverage.minimumStaff [{"from":"04:00","to":"08:00","count":2}], not role composition.
- Do not infer roles. Only use coverage.openers.composition or coverage.closers.composition when roles are explicitly named.
- coverage.openers.by: shifts that START at or before this time count toward opening coverage
- coverage.openers.composition: minimum required role mix — each {role, count} means at least that many people of that role must open. Use composition only when the rule says "1 X AND 1 Y".
- coverage.closers.shiftEnd: shifts that END at or after this time are "closers"
- coverage.closers.composition: same as openers.composition but for closing shifts
- coverage.preCloser: people whose shift ends near shiftEnd (before full close)
- coverage.alwaysPresent: roles that must have at least one person on shift all day
- coverage.minimumStaff: minimum staff count during a time window
- employeeRules.pairTogether: pairs of employees who must work on the same days
- employeeRules.avoidTogether: pairs who must never be on the same shift
- employeeRules.maxDays: maximum days per week per employee {"Name": N}
- employeeRules.maxCloses: maximum closing shifts per week per employee {"Name": N}
- employeeRules.preferShiftWindows: preferred time window per employee {"Name": {"start": "HH:MM", "end": "HH:MM"}}
- employeeRules.shiftHoursByEmployee: exact shift length by employee when text says someone should have 4-hour shifts, shorter shifts, half shifts, or any specific shift length
- employeeRules.trainingPairs: if trainee is working, ensure a mentor with mentorRole is also scheduled
- employeeRules.preferredEmployeesByDay: employees to prioritize on specific days {"dayname": ["Name"]}
- All times in 24-hour HH:MM format`

  try {
    const text = await callGenerateAPI(aiPrompt)
    let clean = text.trim()
    if (clean.startsWith('```json')) clean = clean.replace(/^```json\n?/, '').replace(/\n?```$/, '')
    else if (clean.startsWith('```')) clean = clean.replace(/^```\n?/, '').replace(/\n?```$/, '')
    const first = clean.indexOf('{')
    const last = clean.lastIndexOf('}')
    if (first === -1 || last === -1) return null
    return JSON.parse(clean.slice(first, last + 1))
  } catch {
    return null
  }
}

// JS validator — checks hard rules and structured scheduling rules.
// Never makes scheduling decisions. Returns violation strings for the AI to fix.
function validateSchedule(data, employees, parsedRules = null) {
  const violations = []
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const empMap = Object.fromEntries(employees.map(e => [e.name, e]))
  const weekTotals = {}
  const toM = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0) }
  const coverageRules = parsedRules?.coverage || null
  const employeeRules = parsedRules?.employeeRules || null

  DAYS.forEach(day => {
    const dayData = data.days?.[day]
    if (!dayData?.shifts?.length) return

    const shifts = dayData.shifts
    const seenToday = new Set()

    // --- Per-shift hard rules ---
    shifts.forEach(shift => {
      const emp = empMap[shift.employee]

      if (!emp) {
        violations.push(`${capitalize(day)}: "${shift.employee}" is not a known employee`)
        return
      }

      if (seenToday.has(shift.employee)) {
        violations.push(`${capitalize(day)}: ${shift.employee} is scheduled twice on the same day`)
      }
      seenToday.add(shift.employee)

      if (emp.role && shift.role !== emp.role) {
        violations.push(`${capitalize(day)}: ${shift.employee}'s role is "${emp.role}" — do not change it to "${shift.role}"`)
      }

      const av = emp.availability?.[day]
      if (!av || av.available === false) {
        violations.push(`${capitalize(day)}: ${shift.employee} is not available`)
      } else if (av.start && av.end) {
        const ss = toM(shift.start), se = toM(shift.end)
        const as = toM(av.start), ae = toM(av.end) || 24 * 60
        if (ss < as || se > ae) {
          violations.push(`${capitalize(day)}: ${shift.employee} shift ${shift.start}–${shift.end} is outside availability ${av.start}–${av.end}`)
        }
      }

      const hours = Number(shift.hours) || shiftHours(shift.start, shift.end)
      if (hours < 4) violations.push(`${capitalize(day)}: ${shift.employee} shift is ${hours}h — minimum is 4h`)
      if (hours > 8.5) violations.push(`${capitalize(day)}: ${shift.employee} shift is ${hours}h — maximum is 8.5h`)

      weekTotals[shift.employee] = (weekTotals[shift.employee] || 0) + hours
    })

    // --- Coverage rules (structural, from AI-parsed workspace rules) ---
    if (coverageRules) {
      const { openers, closers, preCloser, alwaysPresent, minimumStaff } = coverageRules

      if (openers) {
        const byMins = toM(openers.by)
        const openerShifts = shifts.filter(s => toM(s.start) <= byMins)
        if (openers.composition?.length) {
          openers.composition.forEach(({ role, count }) => {
            const found = openerShifts.filter(s => s.role === role).length
            if (found < count) {
              violations.push(`${capitalize(day)}: opening (by ${openers.by}) needs at least ${count} ${role}(s) — only ${found} found`)
            }
          })
        } else if (openers.count != null) {
          const found = openerShifts.filter(s => !openers.roles?.length || openers.roles.includes(s.role)).length
          if (found < openers.count) violations.push(`${capitalize(day)}: needs at least ${openers.count} opener(s) by ${openers.by} — only ${found} found`)
        }
      }

      if (closers) {
        const endMins = toM(closers.shiftEnd)
        const closerShifts = shifts.filter(s => toM(s.end) >= endMins)
        if (closers.composition?.length) {
          closers.composition.forEach(({ role, count }) => {
            const found = closerShifts.filter(s => s.role === role).length
            if (found < count) {
              violations.push(`${capitalize(day)}: closing (at ${closers.shiftEnd}) needs at least ${count} ${role}(s) — only ${found} found`)
            }
          })
        } else if (closers.count != null) {
          const found = closerShifts.filter(s => !closers.roles?.length || closers.roles.includes(s.role)).length
          if (found < closers.count) violations.push(`${capitalize(day)}: needs ${closers.count} closer(s) ending at or after ${closers.shiftEnd} — only ${found} found`)
        }
      }

      if (preCloser) {
        const targetMins = toM(preCloser.shiftEnd)
        const found = shifts.filter(s =>
          Math.abs(toM(s.end) - targetMins) <= 30 &&
          (!preCloser.roles?.length || preCloser.roles.includes(s.role))
        ).length
        if (found < preCloser.count) {
          violations.push(`${capitalize(day)}: needs ${preCloser.count} pre-closer(s) ending around ${preCloser.shiftEnd}${preCloser.roles?.length ? ` (${preCloser.roles.join(' or ')})` : ''} — only ${found} found`)
        }
      }

      if (alwaysPresent?.length) {
        alwaysPresent.forEach(role => {
          if (!shifts.some(s => s.role === role)) {
            violations.push(`${capitalize(day)}: ${role} must always be present — none scheduled`)
          }
        })
      }

      if (minimumStaff?.length) {
        minimumStaff.forEach(({ from, to, count }) => {
          const fromMins = toM(from), toMins = toM(to)
          const active = shifts.filter(s => toM(s.start) < toMins && toM(s.end) > fromMins).length
          if (active < count) {
            violations.push(`${capitalize(day)}: needs ${count} staff from ${from}–${to} — only ${active} on shift`)
          }
        })
      }
    }

    if (employeeRules) {
      ;(employeeRules.pairTogether || []).forEach(([a, b]) => {
        const aShifts = shifts.filter(s => s.employee === a)
        const bShifts = shifts.filter(s => s.employee === b)
        if (aShifts.length !== bShifts.length || (aShifts.length > 0 && bShifts.length === 0)) {
          violations.push(`${capitalize(day)}: ${a} and ${b} must be scheduled together`)
        } else if (aShifts.length && !aShifts.some(aShift => bShifts.some(bShift => shiftsOverlap(aShift, bShift)))) {
          violations.push(`${capitalize(day)}: ${a} and ${b} are both scheduled but their shifts do not overlap`)
        }
      })

      ;(employeeRules.avoidTogether || []).forEach(([a, b]) => {
        const aShifts = shifts.filter(s => s.employee === a)
        const bShifts = shifts.filter(s => s.employee === b)
        if (aShifts.some(aShift => bShifts.some(bShift => shiftsOverlap(aShift, bShift)))) {
          violations.push(`${capitalize(day)}: ${a} and ${b} must not work the same shift`)
        }
      })

      Object.entries(employeeRules.shiftHoursByEmployee || {}).forEach(([employee, expectedHours]) => {
        shifts
          .filter(s => s.employee === employee)
          .forEach(shift => {
            const actualHours = Number(shift.hours) || shiftHours(shift.start, shift.end)
            if (Math.abs(actualHours - Number(expectedHours)) > 0.05) {
              violations.push(`${capitalize(day)}: ${employee} should have ${expectedHours}h shifts — scheduled ${actualHours}h`)
            }
          })
      })
    }
  })

  if (employeeRules) {
    Object.entries(employeeRules.maxDays || {}).forEach(([employee, max]) => {
      const days = DAYS.filter(day =>
        (data.days?.[day]?.shifts || []).some(shift => shift.employee === employee)
      ).length
      if (days > Number(max)) {
        violations.push(`${employee}: scheduled ${days} days but maximum is ${max}`)
      }
    })

    Object.entries(employeeRules.maxCloses || {}).forEach(([employee, max]) => {
      const closes = DAYS.filter(day => {
        const shifts = data.days?.[day]?.shifts || []
        const latestEnd = shifts.reduce((latest, shift) => Math.max(latest, toM(shift.end)), 0)
        return shifts.some(shift => shift.employee === employee && toM(shift.end) >= latestEnd - 30)
      }).length
      if (closes > Number(max)) {
        violations.push(`${employee}: scheduled ${closes} closing shifts but maximum is ${max}`)
      }
    })
  }

  // --- Weekly target check (over AND under) ---
  employees.forEach(emp => {
    if (emp.targetHours == null) return
    const total = Math.round((weekTotals[emp.name] || 0) * 10) / 10
    const diff = Math.round((total - emp.targetHours) * 10) / 10

    if (diff > 0.05) {
      violations.push(`${emp.name}: scheduled ${total}h but target is ${emp.targetHours}h — ${diff}h over`)
    } else if (diff < -1) {
      // Find days they're available but not yet scheduled
      const openDays = DAYS.filter(d => {
        const av = emp.availability?.[d]
        if (!av || av.available === false) return false
        return !(data.days?.[d]?.shifts || []).some(s => s.employee === emp.name)
      })
      if (openDays.length > 0) {
        violations.push(`${emp.name}: only ${total}h scheduled but target is ${emp.targetHours}h — add shifts on: ${openDays.map(capitalize).join(', ')}`)
      } else {
        violations.push(`${emp.name}: only ${total}h scheduled but target is ${emp.targetHours}h — no unused available days remain`)
      }
    }
  })

  return violations
}

function buildConstraintsFromParsedRules(parsedRules, operatingHours) {
  const slots = []
  const pairs = []
  const avoid = []
  const maxDays = {}
  const maxCloses = {}
  const preferWindows = {}
  const shiftHoursByEmployee = {}
  const trainingPairs = []
  const prioritize = {}
  const minimumStaff = []

  if (!parsedRules) return { slots, pairs, avoid, maxDays, maxCloses, preferWindows, shiftHoursByEmployee, trainingPairs, prioritize, minimumStaff }

  const { coverage, employeeRules } = parsedRules

  if (coverage) {
    const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
    const firstOpen = DAYS.find(d => operatingHours?.[d]?.open)
    const opStart = firstOpen ? operatingHours[firstOpen].start : '05:00'
    const opEnd   = firstOpen ? operatingHours[firstOpen].end   : '20:30'

    const { openers, closers, preCloser } = coverage

    if (openers?.composition) {
      const latestStart = openers.by || opStart
      openers.composition.forEach(({ role, count }) =>
        slots.push({ start: opStart, end: '13:00', role, count, days: 'all', latestStart })
      )
    } else if (openers?.count) {
      slots.push({ start: opStart, end: '13:00', count: openers.count, days: 'all', latestStart: openers.by || opStart })
    }

    if (closers?.composition) {
      const minEnd = closers.shiftEnd || opEnd
      closers.composition.forEach(({ role, count }) =>
        slots.push({ start: '12:00', end: closers.shiftEnd || opEnd, role, count, days: 'all', anchor: 'end', minEnd })
      )
    } else if (closers?.count) {
      slots.push({ start: '12:00', end: closers.shiftEnd || opEnd, count: closers.count, days: 'all', anchor: 'end', minEnd: closers.shiftEnd || opEnd })
    }

    if (preCloser?.count && preCloser?.shiftEnd) {
      const roles = Array.isArray(preCloser.roles) && preCloser.roles.length ? preCloser.roles : [null]
      roles.forEach(role => {
        slots.push({ start: '12:00', end: preCloser.shiftEnd, role, count: preCloser.count, days: 'all', anchor: 'end', minEnd: preCloser.shiftEnd })
      })
    }

    if (Array.isArray(coverage.minimumStaff)) {
      minimumStaff.push(...coverage.minimumStaff)
    }
  }

  if (employeeRules) {
    if (Array.isArray(employeeRules.pairTogether)) pairs.push(...employeeRules.pairTogether)
    if (Array.isArray(employeeRules.avoidTogether)) avoid.push(...employeeRules.avoidTogether)
    if (employeeRules.maxDays) Object.assign(maxDays, employeeRules.maxDays)
    if (employeeRules.maxCloses) Object.assign(maxCloses, employeeRules.maxCloses)
    if (employeeRules.preferShiftWindows) Object.assign(preferWindows, employeeRules.preferShiftWindows)
    if (employeeRules.shiftHoursByEmployee) Object.assign(shiftHoursByEmployee, employeeRules.shiftHoursByEmployee)
    if (Array.isArray(employeeRules.trainingPairs)) trainingPairs.push(...employeeRules.trainingPairs)
    if (employeeRules.preferredEmployeesByDay) Object.assign(prioritize, employeeRules.preferredEmployeesByDay)
  }

  return { slots, pairs, avoid, maxDays, maxCloses, preferWindows, shiftHoursByEmployee, trainingPairs, prioritize, minimumStaff }
}

function shiftHours(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let h = (eh + em / 60) - (sh + sm / 60)
  if (h < 0) h += 24
  return Math.round(h * 10) / 10
}

function shiftStartMins(shift) {
  const [h, m] = (shift.start || '0:0').split(':').map(Number)
  return h * 60 + (m || 0)
}

function shiftEndMins(shift) {
  const [h, m] = (shift.end || '0:0').split(':').map(Number)
  const mins = h * 60 + (m || 0)
  return mins === 0 ? 24 * 60 : mins
}

function shiftsOverlap(a, b) {
  return shiftStartMins(a) < shiftEndMins(b) && shiftEndMins(a) > shiftStartMins(b)
}

function pairedShiftsOverlap(shifts, a, b) {
  const aShifts = shifts.filter(shift => shift.employee === a)
  const bShifts = shifts.filter(shift => shift.employee === b)
  return aShifts.some(aShift => bShifts.some(bShift => shiftsOverlap(aShift, bShift)))
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default Schedule
