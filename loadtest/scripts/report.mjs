// Turns a k6 summary, the integrity results and resource samples into a
// Markdown run report, with a cost estimate. Pure formatting: no network.

const ms = (v) => (v === undefined || v === null ? '–' : `${Math.round(v)} ms`)
const pct = (v) => (v === undefined ? '–' : `${(v * 100).toFixed(2)}%`)

export function actionRows(summary) {
  const rows = []
  for (const [key, metric] of Object.entries(summary.metrics || {})) {
    const m = key.match(/^http_req_duration\{action:(.+)\}$/)
    if (!m) continue
    const count = summary.metrics[`http_reqs{action:${m[1]}}`]?.values?.count || 0
    if (!count) continue
    const v = metric.values
    rows.push({ action: m[1], count, p50: v.med, p95: v['p(95)'], p99: v['p(99)'], max: v.max })
  }
  return rows.sort((a, b) => b.count - a.count)
}

export function estimateCost(summary, pricing) {
  let reads = 0, writes = 0, invocations = 0
  for (const r of actionRows(summary)) {
    const ops = pricing.opsPerRequest[r.action]
    if (!ops) continue
    reads += ops.reads * r.count
    writes += ops.writes * r.count
    if (ops.function) invocations += r.count
  }
  const f = pricing.firestore
  const v = pricing.vercel
  const firestoreUsd = reads * f.readUsd + writes * f.writeUsd
  const cpuHours = (invocations * v.avgActiveCpuMs) / 3_600_000
  const vercelUsd = invocations * v.invocationUsd + cpuHours * v.activeCpuHourUsd + cpuHours * v.memoryGb * v.memoryGbHourUsd
  return { reads, writes, invocations, firestoreUsd, vercelUsd, totalUsd: firestoreUsd + vercelUsd }
}

export function renderReport({ runId, profile, script, environment, summary, integrity, resources, sinks, pricing, startedAt, finishedAt }) {
  const m = summary.metrics || {}
  const val = (k, f) => m[k]?.values?.[f]
  const thresholdsFailed = Object.entries(m).flatMap(([k, x]) => Object.entries(x.thresholds || {}).filter(([, t]) => !t.ok).map(([t]) => `${k}: ${t}`))
  const cost = estimateCost(summary, pricing)
  const durationS = (val('iteration_duration', 'count') !== undefined && summary.state?.testRunDurationMs) ? summary.state.testRunDurationMs / 1000 : null
  const lines = [
    `# Load-test run ${runId}`,
    '',
    `- Profile: **${profile}** (${script}), environment: **${environment}**`,
    `- Started ${startedAt}, finished ${finishedAt}${durationS ? `, ${durationS.toFixed(0)} s of traffic` : ''}`,
    `- Max concurrent VUs: **${val('vus_max', 'max') ?? val('vus', 'max') ?? '–'}**`,
    `- Requests: **${val('http_reqs', 'count') ?? 0}**, mean throughput **${(val('http_reqs', 'rate') ?? 0).toFixed(2)} req/s**`,
    `- Latency (all requests): p50 ${ms(val('http_req_duration', 'med'))}, p95 ${ms(val('http_req_duration', 'p(95)'))}, p99 ${ms(val('http_req_duration', 'p(99)'))}, max ${ms(val('http_req_duration', 'max'))}`,
    `- Unexpected responses: ${pct(val('unexpected_responses', 'rate'))}; HTTP 429 share: ${pct(val('rate_limited', 'rate'))}; timeouts: ${val('timeouts', 'count') ?? 0}; auth failures: ${val('auth_failures', 'count') ?? 0}`,
    `- Business conflicts (409/422, expected under contention): ${val('business_conflicts', 'count') ?? 0}`,
    `- Security violations: **${val('security_violations', 'count') ?? 0}**`,
    `- Thresholds: ${thresholdsFailed.length ? `**FAILED** — ${thresholdsFailed.join('; ')}` : 'all passed'}`,
    `- Outbound provider calls caught by local sinks: AI ${sinks?.ai ?? 'n/a'}, push ${sinks?.push ?? 'n/a'}`,
    '',
  ]
  const rows = actionRows(summary)
  if (rows.length) {
    lines.push('## Per action', '', '| Action | Requests | p50 | p95 | p99 | max |', '|---|---:|---:|---:|---:|---:|')
    for (const r of rows) lines.push(`| ${r.action} | ${r.count} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} | ${ms(r.max)} |`)
    lines.push('')
  }
  const custom = Object.entries(m).filter(([k]) => /^(firestore_query_ms|workflow_ms|rate_limited_response_ms)$/.test(k))
  if (custom.length) {
    lines.push('## Timings', '')
    for (const [k, x] of custom) lines.push(`- ${k}: p50 ${ms(x.values.med)}, p95 ${ms(x.values['p(95)'])}, p99 ${ms(x.values['p(99)'])}`)
    lines.push('')
  }
  const checks = Object.entries(m).filter(([k]) => /^(double_bookings|lost_updates|limiter_leaks|missing_retry_after)$/.test(k))
  if (checks.length) {
    lines.push('## Targeted checks', '')
    for (const [k, x] of checks) lines.push(`- ${k}: ${x.values.count}`)
    lines.push('')
  }
  if (integrity) {
    lines.push('## Data integrity (read back from Firestore)', '',
      `- ${integrity.stats.businesses} workplaces, ${integrity.stats.shifts} shifts scanned, ${integrity.stats.runShifts} written by this run, ${integrity.stats.rateLimitCounters ?? '–'} limiter counters`,
      integrity.findings.length ? '' : '- No findings.')
    for (const f of integrity.findings.slice(0, 50)) lines.push(`- **${f.severity}** ${f.check}: ${f.detail}`)
    if (integrity.findings.length > 50) lines.push(`- …and ${integrity.findings.length - 50} more`)
    lines.push('')
  }
  if (resources?.length) {
    const rss = resources.map(r => r.rssMb)
    const cpu = resources.map(r => r.cpu)
    lines.push('## Local API process', '', `- RSS: start ${rss[0]} MB, peak ${Math.max(...rss)} MB, end ${rss.at(-1)} MB`, `- CPU: peak ${Math.max(...cpu)}%`, '')
  }
  lines.push('## Estimated cost of this run', '',
    `- Firestore: ~${cost.reads} reads, ~${cost.writes} writes ≈ $${cost.firestoreUsd.toFixed(4)}`,
    `- Vercel functions: ~${cost.invocations} invocations ≈ $${cost.vercelUsd.toFixed(4)}`,
    `- Per million requests of this mix: ≈ $${((cost.totalUsd / Math.max(1, val('http_reqs', 'count') || 1)) * 1e6).toFixed(2)}`,
    `- Estimates from config/pricing.json (as of ${pricing.asOf}); op counts per action are read off the code, not measured.`, '')
  return lines.join('\n')
}
