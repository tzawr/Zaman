// Reading a schedule someone already has (a spreadsheet, an export from
// another tool) into Teams shifts. Pure functions: the server reads the file
// and stores the result for review; nothing here writes anything.
//
// Every row comes out with what was read, how sure the reading is, and what
// a person needs to check. Nothing an import produces becomes a shift until a
// manager has reviewed it.

import { addDays, daysBetween, isDateString, normalizeTimeInput, parseTime, weekStartOf } from './time.js'

// A month for a large team; a file with more is read up to here, and says so.
export const MAX_IMPORT_ROWS = 1000

// ---- CSV --------------------------------------------------------------------

// RFC 4180, with the delimiter guessed from the first line: comma, semicolon
// (common in European spreadsheet exports) or tab.
export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] || ''
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch in counts) counts[ch]++
  }
  const [best, seen] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const delim = seen ? best : ','

  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cell += ch
    } else if (ch === '"' && cell === '') inQuotes = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''))
}

// ---- Dates and times as people write them ----------------------------------

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// "Monday", "Mon", "mon.", "Mon 26 Oct", "tu". Returns 0 (Monday) to 6, or null.
export function weekdayOf(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.,]/g, '')
  if (t.length < 2) return null
  const i = WEEKDAYS.findIndex(d => d.startsWith(t) || t.startsWith(`${d.slice(0, 3)} `) || t === d.slice(0, 3))
  return i >= 0 ? i : null
}

const pad = (n) => String(n).padStart(2, '0')

// A date from what a spreadsheet holds. Returns { date, sure } or null.
// `year` fills in dates written without one. Day-first vs month-first is
// decided by the numbers where it can be, and otherwise assumed month-first
// and marked unsure.
export function readDate(value, { year, weekStart } = {}) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  // Excel stores dates as days since 1899-12-30.
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const serial = Math.floor(Number(raw))
    if (serial > 30000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
      return { date: d.toISOString().slice(0, 10), sure: true }
    }
  }
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) {
    const date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`
    return isDateString(date) ? { date, sure: true } : null
  }
  m = raw.match(/(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year
    if (!y) return null
    const [month, day, sure] = a > 12 ? [b, a, true] : b > 12 ? [a, b, true] : [a, b, a === b]
    const date = `${y}-${pad(month)}-${pad(day)}`
    return isDateString(date) ? { date, sure: sure && Boolean(m[3] || year) } : null
  }
  m = raw.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?|(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/)
  if (m) {
    const mon = MONTHS.indexOf(m[1] || m[5])
    const day = Number(m[2] || m[4])
    const y = Number(m[3] || m[6]) || year
    if (mon >= 0 && y) {
      const date = `${y}-${pad(mon + 1)}-${pad(day)}`
      if (isDateString(date)) return { date, sure: true }
    }
  }
  // A weekday alone, placed in the week the manager chose.
  const wd = weekdayOf(raw)
  if (wd !== null && weekStart) return { date: addDays(weekStart, wd), sure: true, weekdayOnly: true }
  return null
}

// A time from a spreadsheet: "9", "9:30pm", "21:00", or Excel's fraction of a
// day (0.375 is 9am).
export function readTime(value) {
  const raw = String(value ?? '').trim()
  if (/^0?\.\d+$/.test(raw)) {
    const mins = Math.round(Number(raw) * 24 * 60)
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`
  }
  return normalizeTimeInput(raw.replace(/\s*(a\.?m\.?|p\.?m\.?)$/i, (s) => s.replace(/[.\s]/g, '')))
}

// "9-5", "9am-5pm", "09:00–17:00", "9 to 5". Returns { start, end, sure } or
// null. A bare "9-5" means nine to five: an end that would come before the
// start without am/pm is read as afternoon, and marked unsure.
export function readTimeRange(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  const parts = raw.split(/\s*(?:-|–|—|to|till|until)\s*/).filter(Boolean)
  if (parts.length !== 2) return null
  const start = readTime(parts[0])
  let end = readTime(parts[1])
  if (!start || !end) return null
  let sure = true
  const hasPeriod = /[ap]m?$/.test(parts[0]) || /[ap]m?$/.test(parts[1])
  if (!hasPeriod && !parts[1].includes(':') && parseTime(end) <= parseTime(start) && parseTime(end) < 12 * 60) {
    const pm = parseTime(end) + 12 * 60
    if (pm > parseTime(start)) {
      end = `${pad(Math.floor(pm / 60))}:${pad(pm % 60)}`
      sure = false
    }
  }
  return { start, end, sure }
}

const OFF = /^(off|x|-|—|rest|n\/?a|day off|leave|vacation|pto|holiday)$/i

// ---- Tables -----------------------------------------------------------------

const HEADERS = {
  name: /^(name|employee|employee name|staff|staff name|person|who|team member|worker)$/,
  date: /^(date|day|shift date|work date)$/,
  start: /^(start|start time|from|in|begin|time in|clock in)$/,
  end: /^(end|end time|to|out|finish|time out|clock out)$/,
  range: /^(shift|time|times|hours|shift time|schedule)$/,
  position: /^(position|role|job|station|task|department)$/,
  location: /^(location|site|store|branch|venue|shop)$/,
}

function headerKind(cell) {
  const c = String(cell || '').trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ')
  return Object.keys(HEADERS).find(k => HEADERS[k].test(c)) || null
}

// What a cell in a grid's header row is: a date, or a weekday in the week.
function dayHeader(cell, ctx) {
  const d = readDate(cell, ctx)
  if (d) return d
  const wd = weekdayOf(String(cell).split(/\s+/)[0])
  return wd !== null && ctx.weekStart ? { date: addDays(ctx.weekStart, wd), sure: true, weekdayOnly: true } : null
}

// Day columns named only by weekday, across more than one week (Mon … Sun,
// Mon … Sun): a weekday seen again is the week after.
function spreadWeeks(dayCols) {
  const seen = new Set()
  return dayCols.map(day => {
    if (!day) return day
    let date = day.date
    while (day.weekdayOnly && seen.has(date)) date = addDays(date, 7)
    seen.add(date)
    return { ...day, date }
  })
}

// Turns a table into shift rows. Two layouts are read:
//   list: one shift per row, with name / date / start / end columns
//   grid: one person per row, one day per column, times in the cells
// Returns { layout, rows, problems }.
export function interpretTable(table, { weekStart, year } = {}) {
  const ctx = { weekStart, year: year || (weekStart ? Number(weekStart.slice(0, 4)) : undefined) }
  const problems = []
  const rows = []
  const headerAt = table.slice(0, 6).findIndex(r => r.filter(headerKind).length >= 2 || r.filter(c => dayHeader(c, ctx)).length >= 3)
  if (headerAt < 0) {
    return { layout: null, rows: [], problems: ['Could not find a header row. The first rows should name the columns (Name, Date, Start, End) or the days of the week.'] }
  }
  const header = table[headerAt]
  const body = table.slice(headerAt + 1)
  const kinds = header.map(headerKind)
  const dayCols = spreadWeeks(header.map(c => (headerKind(c) ? null : dayHeader(c, ctx))))

  if (dayCols.filter(Boolean).length >= 3) {
    const nameCol = kinds.indexOf('name') >= 0 ? kinds.indexOf('name') : 0
    for (const r of body) {
      const name = r[nameCol]
      if (!name) continue
      dayCols.forEach((day, i) => {
        if (!day) return
        const cell = String(r[i] || '').trim()
        if (!cell || OFF.test(cell)) return
        // A split shift like "10-2 / 5-9": a later piece that would start
        // before the earlier one ends, with no am or pm, is the evening.
        let previousEnd = null
        for (const piece of cell.split(/\s*[/,;\n]\s*/)) {
          let range = readTimeRange(piece)
          if (range && previousEnd !== null && !/[ap]m?\b/i.test(piece)
            && parseTime(range.start) < previousEnd && parseTime(range.start) + 12 * 60 >= previousEnd) {
            const later = (t) => { const m = parseTime(t) + 12 * 60; return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}` }
            range = { start: later(range.start), end: later(range.end), sure: false }
          }
          if (range) previousEnd = parseTime(range.end) <= parseTime(range.start) ? parseTime(range.end) + 24 * 60 : parseTime(range.end)
          rows.push(range
            ? { name, date: day.date, start: range.start, end: range.end, positionName: null, location: null,
                sure: { name: true, date: day.sure, times: range.sure } }
            : { name, date: day.date, start: null, end: null, positionName: null, location: null, raw: piece,
                sure: { name: true, date: day.sure, times: false } })
        }
      })
    }
    return { layout: 'grid', rows, problems }
  }

  const col = (k) => kinds.indexOf(k)
  if (col('name') < 0) problems.push('There is no column for who works each shift (Name, Employee or Staff).')
  if (col('date') < 0) problems.push('There is no Date or Day column.')
  if (col('range') < 0 && (col('start') < 0 || col('end') < 0)) problems.push('There are no Start and End columns, or a Shift column like “9am-5pm”.')
  if (problems.length) return { layout: 'list', rows: [], problems }

  for (const r of body) {
    const name = r[col('name')]
    if (!name) continue
    const day = readDate(r[col('date')], ctx)
    // Separate Start and End columns are read as one range, so 9 and 5
    // get the same nine-to-five reading as 9-5 in one cell.
    const range = col('range') >= 0 ? readTimeRange(r[col('range')])
      : r[col('start')] && r[col('end')] ? readTimeRange(`${r[col('start')]} - ${r[col('end')]}`) : null
    const start = range?.start ?? readTime(r[col('start')])
    const end = range?.end ?? readTime(r[col('end')])
    rows.push({
      name,
      date: day?.date || null,
      start: start || null,
      end: end || null,
      positionName: col('position') >= 0 ? r[col('position')] || null : null,
      location: col('location') >= 0 ? r[col('location')] || null : null,
      raw: !day || !start || !end ? r.join(' | ') : undefined,
      sure: { name: true, date: Boolean(day?.sure), times: Boolean(start && end) && (range ? range.sure : false) },
    })
  }
  return { layout: 'list', rows, problems }
}

// ---- Matching names to the roster -------------------------------------------

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ ]/g, ' ').replace(/\s+/g, ' ').trim()

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}

// Who on the roster a name in a file means. An exact match (ignoring case,
// accents and punctuation) is applied; anything looser is only suggested,
// for a person to confirm.
export function matchStaff(name, staff) {
  const n = norm(name)
  if (!n) return { status: 'none', staffId: null }
  const live = staff.filter(s => !s.archived)
  const exact = live.filter(s => norm(s.name) === n)
  if (exact.length === 1) return { status: 'exact', staffId: exact[0].id }
  if (exact.length > 1) return { status: 'ambiguous', staffId: null, candidates: exact.map(s => s.id) }

  const [first, ...rest] = n.split(' ')
  const lastInitial = rest.at(-1)?.[0]
  const byFirst = live.filter(s => {
    const [f, ...r] = norm(s.name).split(' ')
    return f === first && (!lastInitial || r.at(-1)?.[0] === lastInitial)
  })
  if (byFirst.length === 1) return { status: 'suggested', staffId: byFirst[0].id }

  const close = live.map(s => ({ s, d: distance(norm(s.name), n) })).filter(x => x.d <= Math.max(1, Math.floor(n.length / 6)))
    .sort((a, b) => a.d - b.d)
  if (close.length === 1 || (close.length > 1 && close[0].d < close[1].d)) return { status: 'suggested', staffId: close[0].s.id }
  if (byFirst.length > 1) return { status: 'ambiguous', staffId: null, candidates: byFirst.map(s => s.id) }
  return { status: 'none', staffId: null }
}

// ---- Review -----------------------------------------------------------------

// What stops a row from becoming a shift: who works it, and when. Only
// these hold an import back.
export function rowIssues(row) {
  const issues = []
  if (!row.staffId) issues.push(row.match === 'ambiguous' ? 'More than one person has this name. Pick who it is.' : 'Pick who works this shift.')
  if (!row.date) issues.push('No date.')
  if (!row.start || !row.end) issues.push('No start and end time.')
  return issues
}

// What the file left uncertain, for the manager to glance at. Unlike
// rowIssues, none of it stops the import: adding the shifts accepts it.
export function rowWarnings(row) {
  if (row.confirmed || !row.sure) return []
  const warnings = []
  if (!row.sure.name) warnings.push('The name was hard to read.')
  if (!row.sure.date) warnings.push('The date could be read two ways.')
  if (!row.sure.times) warnings.push('The times were guessed.')
  return warnings
}

// The people an import names, with how many shifts each has and who on the
// team they will be: decided once per person, not once per shift.
export function importPeople(rows) {
  const people = new Map()
  for (const r of rows) {
    const p = people.get(r.name) || { name: r.name, staffId: r.staffId, match: r.match, candidates: r.candidates || [], count: 0, included: 0 }
    p.count++
    if (r.include) p.included++
    people.set(r.name, p)
  }
  return [...people.values()]
}

// The rows of an import, matched to the roster and given ids, ready for
// review. `extracted` rows come from interpretTable or from AI extraction.
export function prepareRows(extracted, staff) {
  return extracted.slice(0, MAX_IMPORT_ROWS).map((r, i) => {
    const m = matchStaff(r.name, staff)
    const name = String(r.name || '').slice(0, 80)
    // Someone not on the team yet is added with the import, unless the
    // manager says otherwise.
    const isNew = m.status === 'none' && Boolean(name.trim())
    const row = {
      id: `r${i}`,
      name,
      staffId: isNew ? 'new' : m.staffId,
      match: isNew ? 'new' : m.status,
      candidates: m.candidates || [],
      date: isDateString(r.date) ? r.date : null,
      start: r.start ? normalizeTimeInput(r.start) : null,
      end: r.end ? normalizeTimeInput(r.end) : null,
      positionName: r.positionName ? String(r.positionName).slice(0, 40) : null,
      location: r.location ? String(r.location).slice(0, 80) : null,
      raw: r.raw ? String(r.raw).slice(0, 200) : null,
      sure: r.sure || { name: true, date: true, times: true },
      include: true,
      confirmed: false,
    }
    return { ...row, issues: rowIssues(row) }
  })
}

// The week most of an import's rows fall in, for showing it.
export function importWeek(rows) {
  const counts = {}
  rows.filter(r => r.date).forEach(r => { const w = weekStartOf(r.date); counts[w] = (counts[w] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

// The longest stretch one import may cover: a month and a bit.
export const MAX_RANGE_DAYS = 62

// Places an import's shifts in the days the manager chose. Each row keeps
// the date the file gave it as `fileDate`, so the range can change again.
//
// When none of the file's dates fall in the range (a file for September, a
// range in October), the whole file moves by whole weeks so its first week
// starts the range: weekdays stay where the file put them. Shifts that end
// up outside the range are left out, not deleted, and can be put back.
export function placeInRange(rows, { from, to }) {
  const base = rows.map(r => ({ ...r, fileDate: r.fileDate ?? r.date }))
  const dated = base.map(r => r.fileDate).filter(Boolean).sort()
  if (!dated.length) return { rows: base, movedByDays: 0, leftOut: 0 }
  const fits = dated.some(d => d >= from && d <= to)
  const movedByDays = fits ? 0 : daysBetween(weekStartOf(dated[0]), weekStartOf(from))
  let leftOut = 0
  const placed = base.map(r => {
    if (!r.fileDate) return r
    const date = addDays(r.fileDate, movedByDays)
    const inside = date >= from && date <= to
    if (!inside && r.include !== false) leftOut++
    return { ...r, date, include: inside ? (r.outOfRange ? true : r.include) : false, outOfRange: !inside }
  })
  return { rows: placed, movedByDays, leftOut }
}
