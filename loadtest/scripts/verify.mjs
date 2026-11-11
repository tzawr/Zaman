import { INTRUSION_SUFFIX, runTag } from '../lib/tag.js'

// Data-integrity checks after a run, read straight from Firestore with the
// Admin SDK (emulator only). Responses can say 200 while the stored data is
// wrong; this looks at what was actually stored.

const OVERLAP = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs

export async function verifyIntegrity({ db, runId, summary, actions }) {
  const findings = []
  const stats = { businesses: 0, shifts: 0, runShifts: 0 }
  const bizSnaps = await db.collection('businesses').get()
  for (const biz of bizSnaps.docs) {
    stats.businesses++
    const [shifts, staff, schedules] = await Promise.all([
      biz.ref.collection('shifts').get(),
      biz.ref.collection('staff').get(),
      biz.ref.collection('schedules').get(),
    ])
    const staffIds = new Set(staff.docs.map(d => d.id))
    const weeks = new Set(schedules.docs.map(d => d.id))
    const byPerson = new Map()
    for (const d of shifts.docs) {
      const s = d.data()
      stats.shifts++
      if (s.positionName === runTag(runId)) stats.runShifts += s.status === 'cancelled' ? 0 : 1
      if (String(s.positionName || '').endsWith(`-${INTRUSION_SUFFIX}`)) findings.push({ severity: 'P0', check: 'cross-tenant write', detail: `${biz.id}/shifts/${d.id} was written by another workplace's member` })
      if (s.status === 'cancelled') continue
      if (s.staffId && !staffIds.has(s.staffId)) findings.push({ severity: 'P1', check: 'orphan shift', detail: `${biz.id}/shifts/${d.id} names missing staff ${s.staffId}` })
      if (s.scheduleId && !weeks.has(s.scheduleId)) findings.push({ severity: 'P1', check: 'missing week', detail: `${biz.id}/shifts/${d.id} is in week ${s.scheduleId} with no schedule doc` })
      if (!(s.version >= 1)) findings.push({ severity: 'P1', check: 'version', detail: `${biz.id}/shifts/${d.id} has version ${s.version}` })
      const startMs = s.startAt?.toMillis?.()
      const endMs = s.endAt?.toMillis?.()
      if (!(startMs < endMs)) { findings.push({ severity: 'P1', check: 'times', detail: `${biz.id}/shifts/${d.id} ends before it starts` }); continue }
      if (!s.staffId) continue
      if (!byPerson.has(s.staffId)) byPerson.set(s.staffId, [])
      byPerson.get(s.staffId).push({ id: d.id, startMs, endMs })
    }
    for (const [staffId, list] of byPerson) {
      list.sort((a, b) => a.startMs - b.startMs)
      for (let i = 1; i < list.length; i++) {
        if (OVERLAP(list[i - 1], list[i])) findings.push({ severity: 'P0', check: 'double booking', detail: `${biz.id}: ${staffId} has overlapping shifts ${list[i - 1].id} and ${list[i].id}` })
      }
    }
  }

  // What the run says it created and deleted must match what is stored.
  const m = summary?.metrics || {}
  const created = m.shifts_created?.values?.count || 0
  const deleted = m.shifts_deleted?.values?.count || 0
  if (summary && created && stats.runShifts !== created - deleted) {
    findings.push({ severity: 'P1', check: 'write accounting', detail: `run reported ${created} created - ${deleted} deleted = ${created - deleted}, Firestore holds ${stats.runShifts}` })
  }

  // No limiter counter may pass its limit.
  if (actions) {
    const counters = await db.collection('rateLimits').get()
    for (const d of counters.docs) {
      const { bucket, count } = d.data()
      const name = String(bucket || '').replace(/^teams-/, '')
      const limit = actions[name]?.limit?.[0]
      if (limit && count > limit) findings.push({ severity: 'P0', check: 'rate limit overrun', detail: `${d.id} counted ${count} > ${limit}` })
    }
    stats.rateLimitCounters = counters.size
  }

  // Every AI budget hold was settled or released.
  const usage = await db.collection('aiUsage').get()
  for (const d of usage.docs) {
    const p = Number(d.data().pendingUsd) || 0
    if (Math.abs(p) > 1e-6) findings.push({ severity: 'P2', check: 'AI hold left open', detail: `${d.id} pendingUsd=${p}` })
  }
  return { stats, findings }
}
