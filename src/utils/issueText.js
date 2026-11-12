// Review items are stored as English sentences (they are also what the AI
// recommendations read). For display they are parsed back into a kind and
// its values, so each language can phrase them itself (HQA-15). Anything not
// recognised is shown as stored.

const DAY = '(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'
const PATTERNS = [
  ['staffGap', new RegExp(`^${DAY}: needs (\\d+) staff from (\\S+)–(\\S+) — only (\\d+) on shift$`), ['day', 'count', 'from', 'to', 'on']],
  ['dayMinimum', new RegExp(`^${DAY}: needs at least (\\d+) (?:person|people) on shift — only (\\d+) scheduled$`), ['day', 'count', 'on']],
  ['twice', new RegExp(`^${DAY}: (.+) is scheduled twice on the same day$`), ['day', 'name']],
  ['notAvailable', new RegExp(`^${DAY}: (.+) is not available$`), ['day', 'name']],
  ['outsideAvailability', new RegExp(`^${DAY}: (.+) shift (\\S+)–(\\S+) is outside availability (\\S+)–(\\S+)$`), ['day', 'name', 'start', 'end', 'avStart', 'avEnd']],
  ['timeOff', new RegExp(`^${DAY}: (.+) has approved time off on (\\d{4}-\\d{2}-\\d{2})$`), ['day', 'name', 'date']],
  ['shiftShort', new RegExp(`^${DAY}: (.+) shift is ([\\d.]+)h — minimum is 4h$`), ['day', 'name', 'hours']],
  ['shiftLong', new RegExp(`^${DAY}: (.+) shift is ([\\d.]+)h — maximum is 8.5h$`), ['day', 'name', 'hours']],
  ['unknownEmployee', new RegExp(`^${DAY}: "(.+)" is not a known employee$`), ['day', 'name']],
  ['targetOver', /^(.+): scheduled ([\d.]+)h but target is ([\d.]+)h — ([\d.]+)h over$/, ['name', 'hours', 'target', 'diff']],
  ['targetUnder', /^(.+): only ([\d.]+)h scheduled but target is ([\d.]+)h — add shifts on: (.+)$/, ['name', 'hours', 'target', 'days']],
  ['targetUnderNone', /^(.+): only ([\d.]+)h scheduled but target is ([\d.]+)h — no unused available days remain$/, ['name', 'hours', 'target']],
]

export function parseIssue(text) {
  const s = String(text || '')
  for (const [kind, re, names] of PATTERNS) {
    const m = s.match(re)
    if (m) {
      const params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]))
      if (params.day) params.day = params.day.toLowerCase()
      if (params.days) params.days = params.days.split(/,\s*/).map(d => d.toLowerCase())
      return { kind, params }
    }
  }
  return null
}
