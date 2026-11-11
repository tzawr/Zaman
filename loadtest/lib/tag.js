// The tag a run writes into positionName so its shifts can be found again.
// The API keeps 40 characters of positionName, so the tag is kept short:
// "lt-" plus the run's last 12 digits, plus a short suffix per purpose.
// Plain module: used by k6 scripts and Node alike.
export function runTag(runId, suffix = '') {
  const digits = String(runId).replace(/[^0-9]/g, '').slice(-12) || 'x'
  return `lt-${digits}${suffix ? `-${suffix}` : ''}`
}
export const INTRUSION_SUFFIX = 'intr'
