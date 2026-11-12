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
  AlertTriangle,
  ArrowRight,
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
import { auth, db } from '../firebase'
import { useAuth } from '../AuthContext'
import ScheduleTable from '../components/ScheduleTable'
import { exportToCSV, exportToPNG, exportToPDF } from '../utils/exportSchedule'
import { runScheduler } from '../utils/scheduler'
import { calculateScheduleSummary, revalidateSchedule, validateSchedule } from '../utils/scheduleValidation'
import { mergeEmployeePortalAvailability as mergePortal } from '../utils/schedulingTeam'
import { withTeamsAvailability } from '../utils/teamsAvailability'
import { toMinutes } from '../utils/shiftTime'
import { useSpeechInput } from '../utils/useSpeechInput'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'
import {
  canExport,
  canGenerateSchedule as canGenerateScheduleGate,
  canUsePlainLanguageRules,
  canViewRecommendationsForTier,
  enforceScheduleHistoryLimit,
  getUserTier,
} from '../utils/tier'
import { getSetupStatus, describeMissingSetup, DAY_KEYS } from '../utils/setupChecklist'
import { reportError } from '../utils/reportError'
import { defaultWeekStart, formatDayDate, formatWeekRange, normalizeWeekStart } from '../utils/weekDates'
import { RuleParseError, errorForResponse, extractRulesJson, hasWrittenRules, rulesOutcome, rulesStep } from '../utils/ruleParsing'

function Schedule() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { t, tf, language } = useI18n()
  const generationSeedRef = useRef(0)
  // The team as it was checked at generation (with Teams availability and
  // time off merged in), reused to check manual edits to that week.
  const checkTeamRef = useRef(null)
  
  const [employees, setEmployees] = useState([])
  // Until the first snapshot arrives the team looks empty, and generating
  // would wrongly report "no team members". Generate waits for it.
  const [employeesLoaded, setEmployeesLoaded] = useState(false)
  const [userSettings, setUserSettings] = useState(null)
  const [prompt, setPrompt] = useState('')
  // Always a Monday: next week's, in the manager's own calendar (HQA-08).
  const [weekStart, setWeekStart] = useState(() => {
    // "Build this week again" from a history warning links here with ?week=.
    const asked = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('week')
    return normalizeWeekStart(asked) || defaultWeekStart()
  })
  // The day the manager actually picked, when it was not a Monday.
  const [pickedDay, setPickedDay] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [setupProblems, setSetupProblems] = useState([])
  // Set when the written rules could not be read: generation stops and the
  // manager chooses to retry or to continue without them.
  const [ruleFailure, setRuleFailure] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [scheduleData, setScheduleData] = useState(null)
  const [exporting, setExporting] = useState(null) // null | 'csv' | 'png' | 'pdf'
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [tier, setTier] = useState('free')
  const specialSpeech = useSpeechInput((text) => {
    setPrompt(prev => prev ? `${prev.trim()}\n${text}` : text)
  })

  useEffect(() => {
    if (!currentUser) navigate('/signin')
  }, [currentUser, navigate])

  const mergeEmployeePortalAvailability = useCallback(
    (team) => mergePortal(currentUser?.uid, team),
    [currentUser]
  )

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
      setEmployeesLoaded(true)
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

  useEffect(() => {
    if (!currentUser) return
    getUserTier(currentUser.uid).then(setTier).catch(() => setTier('free'))
  }, [currentUser, userSettings])

  // Every failure on the way to a schedule ends up on screen. Steps before
  // the main try (team availability, plan checks) used to throw past it, and
  // the button then simply did nothing; a missing index did exactly that.
  async function generateSchedule(options) {
    try {
      await runGenerateSchedule(options)
    } catch (err) {
      console.error(err)
      reportError('schedule.generate', err)
      setGenerating(false)
      setError(t('scheduleFailedGenerate'))
    }
  }

  async function runGenerateSchedule({ skipRules = false } = {}) {
    setError('')
    setRuleFailure(null)
    setSetupProblems([])
    setScheduleData(null)
    setSaved(false)
    setCopied(false)

    // Availability can arrive either from the employee record or from an
    // invited employee's own portal, so merge before deciding what is missing.
    // A workspace connected to Hengam Teams takes availability and approved
    // time off from Teams, which is where its people keep them.
    const teams = await withTeamsAvailability(await mergeEmployeePortalAvailability(employees), {
      teamsBizId: userSettings?.teamsBizId, weekStart,
    })
    const schedulingEmployees = teams.employees
    if (teams.error) setError(teams.error)

    const problems = describeMissingSetup(
      getSetupStatus({ userData: userSettings, employees: schedulingEmployees }),
      tf,
      t
    )
    if (problems.length > 0) {
      setSetupProblems(problems)
      return
    }

    const generationGate = await canGenerateScheduleGate(currentUser.uid)
    if (generationGate.blocked) {
      setError(generationGate.message)
      return
    }
    const plainLanguageGate = await canUsePlainLanguageRules(currentUser.uid)

    // Defensive: generation and saving only ever see a real Monday.
    const monday = normalizeWeekStart(weekStart)
    if (!monday) {
      setError(t('scheduleFailedGenerate'))
      return
    }
    if (monday !== weekStart) setWeekStart(monday)

    const step = rulesStep({
      hasRules: hasWrittenRules(userSettings.coverageRules, prompt),
      planAllows: !plainLanguageGate.blocked,
      skipRules,
    })

    try {
      setGenerating(true)

      // Step 1: Parse both coverage rules and special instructions into
      // structured constraints (AI, cached). A failure stops here: the week
      // is never built from rules the manager wrote but we could not read.
      let aiRules = null
      if (step === 'parse') {
        try {
          aiRules = await parseSchedulingInstructionsCached(userSettings.coverageRules, prompt)
        } catch (err) {
          if (!(err instanceof RuleParseError)) throw err
          // A limit or an expired session is the account's state, not a fault.
          if (err.kind === 'unavailable' || err.kind === 'unreadable') reportError(`schedule.rules.${err.kind}`, err.kind)
          setRuleFailure({ kind: err.kind, message: err.serverMessage })
          return
        }
      }
      // Local name-based hints only come from this week's instructions, so
      // they are dropped too when the manager chose to go without them.
      const parsedRules = step === 'skipped' ? null : enhanceParsedRules(aiRules, prompt, schedulingEmployees)

      // Step 2: Build deterministic constraints from structured rules
      const constraints = buildConstraintsFromParsedRules(
        parsedRules,
        userSettings.operatingHours,
        userSettings.coverage
      )

      // Step 3: Try several deterministic variants and keep the cleanest one.
      let best = null
      generationSeedRef.current += 1
      const baseSeed = hashScheduleSeed(monday, prompt, generationSeedRef.current)
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = runScheduler(schedulingEmployees, userSettings, monday, {
          ...constraints,
          seed: baseSeed + attempt,
        })
        const violations = validateSchedule(candidate, schedulingEmployees, parsedRules, {
          coverage: userSettings.coverage,
          operatingHours: userSettings.operatingHours,
        })
        const score = scoreScheduleCandidate(candidate, violations, schedulingEmployees, parsedRules?.employeeRules)
        if (!best || score < best.score) {
          best = { result: candidate, violations, score }
        }
        if (score === 0) break
      }

      // Step 4: Validate and surface any unsatisfied constraints as issues
      const result = best.result
      result.summary = calculateScheduleSummary(result, schedulingEmployees)
      // The rules this week was checked against travel with it, so a manual
      // edit later is checked against the same rules (HQA-09).
      result.checkedRules = parsedRules || null
      checkTeamRef.current = schedulingEmployees
      result.issues = best.violations
      if (best.violations.length > 0) {
        console.warn('[scheduler] violations:', best.violations)
        result.issues = best.violations
        result.recommendations = canViewRecommendationsForTier(tier)
          ? await generateScheduleRecommendations(result, best.violations, schedulingEmployees)
          : []
      }

      Object.assign(result, rulesOutcome(step))

      // Step 5: Save and display
      const finalText = JSON.stringify(result, null, 2)
      setScheduleData(result)
      await saveSchedule(finalText, result)

    } catch (err) {
      console.error(err)
      reportError('schedule.generate', err)
      setError(err.message || t('scheduleFailedGenerate'))
    } finally {
      setGenerating(false)
    }
  }

  async function handleScheduleUpdate(newData) {
    // Every edit is checked again before it is shown or saved, so the saved
    // version and its review items always describe the same shifts (HQA-09).
    const checked = revalidateSchedule(newData, checkTeamRef.current || employees, {
      coverage: userSettings?.coverage,
      operatingHours: userSettings?.operatingHours,
    })
    setScheduleData(checked)
    // Each edit is saved as a new version in Schedule history.
    await saveSchedule(JSON.stringify(checked, null, 2), checked)
  }

  async function saveSchedule(scheduleText, parsedData) {
    try {
      await addDoc(collection(db, 'schedules'), {
        userId: currentUser.uid,
        // The week the result was built for, not whatever the picker shows now.
        weekStart: parsedData?.weekStart || normalizeWeekStart(weekStart),
        content: scheduleText,
        data: parsedData || null,
        instructions: prompt || null,
        employeeCount: employees.length,
        createdAt: serverTimestamp(),
        rulesApplied: parsedData?.rulesApplied ?? null,
        rulesSkippedReason: parsedData?.rulesSkippedReason ?? null,
      })
      await enforceScheduleHistoryLimit(currentUser.uid)
      setSaved(true)
    } catch (err) {
      console.error('Failed to save schedule:', err)
    }
  }

  async function handleExport(type) {
    if (!activeScheduleData) return
    const gate = await canExport(currentUser.uid, type)
    if (gate.blocked) {
      setError(gate.message)
      setExportMenuOpen(false)
      return
    }
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
      aria-label={t('a11yWeekStarting')}
      value={weekStart}
      onChange={(e) => {
        // Any day picks its Monday-to-Sunday week; the board, the saved
        // schedule and every export then share the same real dates.
        const picked = e.target.value
        const monday = normalizeWeekStart(picked)
        if (!monday) return
        setWeekStart(monday)
        setPickedDay(picked !== monday ? picked : null)
      }}
    />
    <div className="gen-week-preview">
      {formatWeekRange(weekStart, language)}
    </div>
  </div>
  {pickedDay && (
    <p className="hint-text gen-week-note" role="status">
      {tf('weekMovedToMonday', { picked: formatDayDate(pickedDay, language), monday: formatDayDate(weekStart, language) })}
    </p>
  )}
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
      aria-label={t('specialInstructionsPlaceholder')}
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
    onClick={() => generateSchedule()}
    disabled={generating || !employeesLoaded}
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
  {employeesLoaded && employees.length === 0 && setupProblems.length === 0 && (
    <p className="hint-text">
      <a onClick={() => navigate('/employees')}>{t('addTeamMembers')}</a> {t('addTeamFirstSuffix')}
    </p>
  )}
  {setupProblems.length > 0 && (
    <div className="setup-blocked">
      <div className="setup-blocked-head">
        <AlertTriangle size={15} aria-hidden />
        <span>{t('setupBlockedTitle')}</span>
      </div>
      <ul className="setup-blocked-list">
        {setupProblems.map(problem => (
          <li key={problem.key}>
            <span className="setup-blocked-message">{problem.message}</span>
            <button
              type="button"
              className="setup-blocked-fix"
              onClick={() => navigate(problem.path)}
            >
              <span>{t('setupBlockedFix')}</span>
              <ArrowRight size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )}
  {ruleFailure && (
    <div className="setup-blocked rule-failure" role="alert">
      <div className="setup-blocked-head">
        <AlertTriangle size={15} aria-hidden />
        <span>{t('rulesFailedTitle')}</span>
      </div>
      <p className="setup-blocked-message">
        {t({
          unavailable: 'rulesFailedUnavailable',
          limit: 'rulesFailedLimit',
          unreadable: 'rulesFailedUnreadable',
          signin: 'rulesFailedSignin',
        }[ruleFailure.kind] || 'rulesFailedUnavailable')}
        {ruleFailure.kind === 'limit' && ruleFailure.message ? ` ${ruleFailure.message}` : ''}
      </p>
      <p className="setup-blocked-message">{t('rulesFailedNothingSaved')}</p>
      <div className="rule-failure-actions">
        {ruleFailure.kind !== 'limit' && (
          <button type="button" className="landing-cta-primary" onClick={() => generateSchedule()} disabled={generating}>
            <RotateCw size={14} />
            <span>{t('rulesRetry')}</span>
          </button>
        )}
        <button type="button" className="settings-button" onClick={() => generateSchedule({ skipRules: true })} disabled={generating}>
          <span>{t('rulesContinueWithout')}</span>
        </button>
      </div>
    </div>
  )}
  {error && <p className="hint-text">{error}</p>}
</div>

{activeScheduleData && (
  <div className="schedule-output-section">
    {activeScheduleData.rulesApplied === false && (
      <div className="setup-blocked rules-skipped-banner" role="status">
        <div className="setup-blocked-head">
          <AlertTriangle size={15} aria-hidden />
          <span>{t(activeScheduleData.rulesSkippedReason === 'plan' ? 'rulesSkippedPlan' : 'rulesSkippedChoice')}</span>
        </div>
      </div>
    )}
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
      showRecommendations={canViewRecommendationsForTier(tier)}
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

async function callGenerateAPI(prompt, task) {
  // The endpoint spends money per call, so it only answers signed-in callers.
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new RuleParseError('signin')

  let resp
  try {
    resp = await fetch('/api/generate-schedule', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // The task picks the output ceiling on the server.
    body: JSON.stringify({ prompt, task }),
    })
  } catch {
    // Offline, or the request never got an answer.
    throw new RuleParseError('unavailable')
  }
  if (!resp.ok) {
    throw errorForResponse(resp.status, await resp.json().catch(() => ({})))
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
    const text = await callGenerateAPI(prompt, 'recommendations')
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

  // Errors propagate as RuleParseError: the caller must not treat a failure
  // as "the manager wrote nothing".
  const text = await callGenerateAPI(aiPrompt, 'rules')
  return extractRulesJson(text)
}

function buildConstraintsFromParsedRules(parsedRules, operatingHours, dayCoverage = null) {
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

  // The per-day minimums set in Workspace are a floor for the whole open day.
  // They apply on their own, so free workspaces without AI-parsed rules still
  // get their coverage honoured.
  if (dayCoverage && operatingHours) {
    DAY_KEYS.forEach(dayKey => {
      const opDay = operatingHours[dayKey]
      const minPeople = Number(dayCoverage[dayKey]?.minPeople) || 0
      if (!opDay?.open || minPeople < 1) return
      minimumStaff.push({
        from: opDay.start,
        to: opDay.end,
        count: minPeople,
        days: [dayKey],
      })
    })
  }

  const bundle = () => ({ slots, pairs, avoid, maxDays, maxCloses, preferWindows, shiftHoursByEmployee, trainingPairs, prioritize, minimumStaff })

  if (!parsedRules) return bundle()

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

function shiftStartMins(shift) {
  return toMinutes(shift.start)
}

function shiftEndMins(shift) {
  const mins = toMinutes(shift.end)
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

export default Schedule
