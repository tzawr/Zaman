// Operational status for alerting: gathers a small snapshot from Firestore
// and judges it against thresholds. evaluate() is pure, so the alert logic is
// unit-tested without a database. Only counts and ids leave this module; no
// names, emails or messages from users.

export const DEFAULT_THRESHOLDS = {
  // Server-side errors (API, cron) seen in the last hour.
  serverErrorsWarn: 1,
  serverErrorsCritical: 10,
  // Schedule generation failures reported by browsers in the last hour.
  scheduleFailuresWarn: 1,
  scheduleFailuresCritical: 5,
  // Unexpected sign-in/sign-up errors reported by browsers in the last hour.
  authIssuesWarn: 3,
  authIssuesCritical: 20,
  // AI: calls across all accounts today, and spend across all accounts this month.
  aiCallsTodayWarn: 150,
  aiCallsTodayCritical: 400,
  aiSpendMonthWarnUsd: 20,
  aiSpendMonthCriticalUsd: 50,
  // One account at or above this share of its monthly cap.
  aiAccountCapShareWarn: 0.8,
  // A budget hold left open this long means a request died mid-call.
  aiStuckHoldMinutes: 15,
  // The daily job should have succeeded within this many hours.
  dailyJobMaxAgeHours: 26,
  firestoreSlowMs: 2000,
}

// Each account's monthly cap, by aiUsage document kind.
const MONTH_CAPS_USD = { hengam: 5, teams: 1 }

const LEVELS = ['ok', 'warn', 'critical']
const worst = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b)
const grade = (n, warn, critical) => (n >= critical ? 'critical' : n >= warn ? 'warn' : 'ok')

export function thresholdsFrom(env = process.env) {
  const t = { ...DEFAULT_THRESHOLDS }
  for (const k of Object.keys(t)) {
    const v = env[`OPS_${k.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`]
    if (v !== undefined && v !== '' && Number.isFinite(Number(v))) t[k] = Number(v)
  }
  return t
}

/**
 * @param {object} s snapshot from gather()
 * @param {object} t thresholds
 * @returns {{ level: 'ok'|'warn'|'critical', checks: {name, level, detail}[] }}
 */
export function evaluate(s, t = DEFAULT_THRESHOLDS) {
  const checks = []
  const add = (name, level, detail) => checks.push({ name, level, detail })

  if (!s.firestore.ok) add('firestore', 'critical', 'Firestore did not answer')
  else add('firestore', s.firestore.ms > t.firestoreSlowMs ? 'warn' : 'ok', `${s.firestore.ms} ms`)

  add('server_errors', grade(s.errors.serverLastHour, t.serverErrorsWarn, t.serverErrorsCritical),
    `${s.errors.serverLastHour} in the last hour across ${s.errors.serverFingerprints} distinct errors`)
  add('schedule_failures', grade(s.errors.scheduleLastHour, t.scheduleFailuresWarn, t.scheduleFailuresCritical),
    `${s.errors.scheduleLastHour} in the last hour`)
  add('auth_issues', grade(s.errors.authLastHour, t.authIssuesWarn, t.authIssuesCritical),
    `${s.errors.authLastHour} in the last hour`)

  add('ai_calls_today', grade(s.ai.callsToday, t.aiCallsTodayWarn, t.aiCallsTodayCritical), `${s.ai.callsToday} calls today`)
  add('ai_spend_month', s.ai.spendMonthUsd >= t.aiSpendMonthCriticalUsd ? 'critical' : s.ai.spendMonthUsd >= t.aiSpendMonthWarnUsd ? 'warn' : 'ok',
    `$${s.ai.spendMonthUsd.toFixed(2)} this month`)
  const nearCap = s.ai.accounts.filter(a => a.spendUsd + a.pendingUsd >= (MONTH_CAPS_USD[a.kind] || 5) * t.aiAccountCapShareWarn)
  add('ai_accounts_near_cap', nearCap.length ? 'warn' : 'ok', `${nearCap.length} account(s) at ≥${Math.round(t.aiAccountCapShareWarn * 100)}% of their monthly cap`)
  const stuck = s.ai.accounts.filter(a => a.pendingUsd > 1e-6 && a.minutesSinceUpdate >= t.aiStuckHoldMinutes)
  add('ai_stuck_holds', stuck.length ? 'warn' : 'ok', `${stuck.length} budget hold(s) open longer than ${t.aiStuckHoldMinutes} min`)

  if (s.dailyJob.lastRunAgeHours === null) add('daily_job', 'warn', 'has never recorded a run (is CRON_SECRET set?)')
  else if (s.dailyJob.lastRunAgeHours > t.dailyJobMaxAgeHours) add('daily_job', 'warn', `last run ${Math.round(s.dailyJob.lastRunAgeHours)} h ago`)
  else add('daily_job', s.dailyJob.failed?.length ? 'warn' : 'ok', s.dailyJob.failed?.length ? `last run had failures: ${s.dailyJob.failed.join(', ')}` : `last run ${Math.round(s.dailyJob.lastRunAgeHours)} h ago`)

  return { level: checks.reduce((l, c) => worst(l, c.level), 'ok'), checks }
}

const HOUR = 60 * 60 * 1000

/** Reads what evaluate() needs. A few dozen document reads at most. */
export async function gather(db, now = new Date()) {
  const started = Date.now()
  let firestore = { ok: true, ms: 0 }
  try {
    await Promise.race([db.doc('meta/health').get(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))])
    firestore.ms = Date.now() - started
  } catch {
    firestore = { ok: false, ms: Date.now() - started }
  }

  const day = now.toISOString().slice(0, 10)
  const month = now.toISOString().slice(0, 7)
  const since = now.getTime() - HOUR
  const errors = { serverLastHour: 0, serverFingerprints: 0, scheduleLastHour: 0, authLastHour: 0 }
  const ai = { callsToday: 0, spendMonthUsd: 0, accounts: [] }
  const dailyJob = { lastRunAgeHours: null, failed: null }
  if (!firestore.ok) return { firestore, errors, ai, dailyJob }

  // Errors are grouped per day and fingerprint; an hour can span midnight.
  const days = [...new Set([day, new Date(since).toISOString().slice(0, 10)])]
  const eventSnaps = await Promise.all(days.map(d => db.collection('errorEvents').where('day', '==', d).get()))
  for (const snap of eventSnaps) {
    for (const d of snap.docs) {
      const e = d.data()
      if (!(e.lastSeen?.toMillis?.() >= since)) continue
      const where = String(e.where || '')
      if (e.source === 'server' || e.source === 'cron') { errors.serverLastHour += e.count || 1; errors.serverFingerprints++ }
      else if (where.startsWith('schedule.')) errors.scheduleLastHour += e.count || 1
      else if (where.startsWith('auth.')) errors.authLastHour += e.count || 1
    }
  }

  const [today, thisMonth] = await Promise.all([
    db.collection('aiUsage').where('period', '==', day).get(),
    db.collection('aiUsage').where('period', '==', month).get(),
  ])
  for (const d of today.docs) ai.callsToday += Number(d.data().calls) || 0
  for (const d of thisMonth.docs) {
    const u = d.data()
    const spendUsd = Number(u.spendUsd) || 0
    const pendingUsd = Math.max(0, Number(u.pendingUsd) || 0)
    ai.spendMonthUsd += spendUsd
    const updated = u.updatedAt?.toMillis?.() ?? (u.updatedAt instanceof Date ? u.updatedAt.getTime() : now.getTime())
    ai.accounts.push({ id: d.id, kind: d.id.startsWith('teams-') ? 'teams' : 'hengam', spendUsd, pendingUsd, minutesSinceUpdate: (now.getTime() - updated) / 60000 })
  }

  const job = await db.doc('meta/dailyJob').get()
  if (job.exists) {
    const at = job.data().lastRunAt?.toMillis?.()
    dailyJob.lastRunAgeHours = at ? (now.getTime() - at) / HOUR : null
    dailyJob.failed = job.data().failed || []
  }
  return { firestore, errors, ai, dailyJob }
}
