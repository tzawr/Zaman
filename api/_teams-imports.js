import { Timestamp } from 'firebase-admin/firestore'
import { canTransition, paths } from '../shared/teams/schema.js'
import { importWeek, interpretTable, parseCsv, prepareRows, readDate, rowIssues } from '../shared/teams/imports.js'
import { isDateString, overlaps, resolveShiftTimes, weekStartOf } from '../shared/teams/time.js'
import { validatePersonName } from '../shared/teams/workspace.js'
import { TeamsError, conflict, invalid, notFound } from './_teams-http.js'
import { audit, readManager, requireId } from './_teams-common.js'
import { AI_MEDIA_TYPES, extractWithClaude } from './_teams-extract.js'
import { XlsxError, readXlsx } from './_xlsx.js'

// Importing a schedule a business already has. Reading a file produces an
// import held for review; nothing becomes a shift until a manager has looked
// at every row and applied it, and applying adds draft shifts that still need
// publishing. The file itself is never stored.

// Vercel caps a request body at 4.5 MB; base64 adds a third.
export const MAX_FILE_BYTES = 3 * 1024 * 1024
const MAX_APPLY_ROWS = 300

function kindOf(fileName, mimeType) {
  const ext = String(fileName || '').toLowerCase().split('.').pop()
  if (ext === 'csv' || ext === 'txt' || mimeType === 'text/csv') return 'csv'
  if (ext === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (ext === 'xls') return 'xls'
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (AI_MEDIA_TYPES[mimeType] === 'image' || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'
  return null
}

const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

export async function importSchedule({ db, uid, input, now, aiClient }) {
  const bizId = requireId(input.bizId, 'workspace')
  if (!isDateString(input.weekStart) || weekStartOf(input.weekStart) !== input.weekStart) throw invalid('Choose the week this schedule is for.')
  const weekStart = input.weekStart
  const fileName = String(input.fileName || 'schedule').slice(0, 120)
  const kind = kindOf(fileName, input.mimeType)
  if (!kind) throw invalid('Upload a CSV, Excel (.xlsx), PDF, or a photo of the schedule.')
  if (kind === 'xls') throw invalid('Older .xls files are not supported. Save it as .xlsx or CSV and try again.')
  if (typeof input.data !== 'string' || !input.data) throw invalid('The file was empty.')
  const bytes = Buffer.from(input.data, 'base64')
  if (!bytes.length) throw invalid('The file was empty.')
  if (bytes.length > MAX_FILE_BYTES) throw invalid('That file is over 3 MB. Export just the week you need, or take a smaller photo.')

  // Who may import, and whether this business takes its schedule from Hengam.
  const [, business, staffSnap] = await Promise.all([
    db.runTransaction(tx => readManager(tx, db, bizId, uid)),
    db.doc(paths.business(bizId)).get(),
    db.collection(`businesses/${bizId}/staff`).get(),
  ])
  if (business.data()?.mode === 'hengam') {
    throw conflict('hengam_owned', 'This workspace takes its schedule from Hengam. Build or import it there.')
  }
  const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  let extracted
  let layout = null
  let notes = ''
  if (kind === 'csv' || kind === 'xlsx') {
    let table
    try {
      table = kind === 'csv' ? parseCsv(bytes.toString('utf8')) : readXlsx(bytes)
    } catch (err) {
      if (err instanceof XlsxError) throw invalid(err.message)
      throw err
    }
    const read = interpretTable(table, { weekStart })
    if (!read.rows.length) {
      const problems = read.problems.length ? read.problems : ['No shifts were found in this file.']
      throw new TeamsError(422, 'unreadable', problems.join(' '), problems.map(message => ({ code: 'unreadable', message })))
    }
    extracted = read.rows
    layout = read.layout
  } else {
    const mediaType = kind === 'pdf' ? 'application/pdf' : (AI_MEDIA_TYPES[input.mimeType] ? input.mimeType : IMAGE_TYPES[fileName.toLowerCase().split('.').pop()])
    const ai = await extractWithClaude({
      db, bizId, mediaType, base64: input.data, weekStart, roster: staff.filter(s => !s.archived).map(s => s.name), now, client: aiClient,
    })
    // A shift shown only by weekday lands in the week the manager chose.
    extracted = ai.rows.map(r => ({ ...r, date: r.date || (r.weekday ? readDate(r.weekday, { weekStart })?.date : null) || null }))
    notes = ai.notes
    if (!extracted.length) {
      throw new TeamsError(422, 'unreadable', notes || 'No shifts were found in this file. Try a clearer photo or a CSV export.')
    }
  }

  const rows = prepareRows(extracted, staff)
  const ref = db.collection(`businesses/${bizId}/imports`).doc()
  const at = Timestamp.fromDate(now)
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      status: 'review', source: kind, fileName, weekStart, layout, notes: notes || null,
      rows, week: importWeek(rows), createdBy: uid, createdAt: at, updatedAt: at,
    })
    audit(tx, db, bizId, uid, 'import.read', { importId: ref.id, source: kind, rows: rows.length }, now)
  })
  return { importId: ref.id, rows: rows.length, needsReview: rows.filter(r => r.issues.length).length }
}

// Applies a reviewed import. The rows sent are the manager's final version;
// each is checked again here, and every included row must be fully resolved.
// New people named in the file can be added to the roster on the way.
export async function applyImport({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const importId = requireId(input.importId, 'import')
  if (!Array.isArray(input.rows)) throw invalid('Nothing to apply.')
  const included = input.rows.filter(r => r && r.include !== false)
  if (!included.length) throw invalid('Choose at least one shift to add.')
  if (included.length > MAX_APPLY_ROWS) throw invalid(`Apply at most ${MAX_APPLY_ROWS} shifts at a time.`)

  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = db.doc(paths.importJob(bizId, importId))
    const [snap, bizSnap, staffSnap] = await Promise.all([
      tx.get(ref), tx.get(db.doc(paths.business(bizId))), tx.get(db.collection(`businesses/${bizId}/staff`)),
    ])
    if (!snap.exists) throw notFound('That import no longer exists.')
    const job = snap.data()
    if (!canTransition('importJob', job.status, 'published')) throw conflict('closed', 'This import was already applied or discarded.')
    const timezone = bizSnap.data().timezone
    const staff = new Map(staffSnap.docs.map(d => [d.id, d.data()]))
    const known = new Set(job.rows.map(r => r.id))

    // Resolve each row to a person and real times, or say what is wrong.
    const newPeople = new Map()
    const problems = []
    const resolved = []
    for (const r of included) {
      if (!known.has(r.id)) { problems.push('A row does not belong to this import.'); continue }
      let staffId = r.staffId
      if (staffId === 'new') {
        const name = validatePersonName(r.name)
        if (!name.ok) { problems.push(name.message); continue }
        const key = name.value.toLowerCase()
        if (!newPeople.has(key)) newPeople.set(key, { id: db.collection(`businesses/${bizId}/staff`).doc().id, name: name.value })
        staffId = newPeople.get(key).id
      } else if (!staff.has(staffId) || staff.get(staffId).archived) {
        problems.push(`${r.name || 'A row'} is not matched to anyone on your team.`)
        continue
      }
      const remaining = rowIssues({ ...r, staffId, match: 'exact', confirmed: true })
      if (remaining.length) { problems.push(`${r.name}: ${remaining.join(' ')}`); continue }
      const times = resolveShiftTimes({ date: r.date, start: r.start, end: r.end, timezone })
      if (!times.ok) { problems.push(`${r.name} on ${r.date}: ${times.message}`); continue }
      const staffName = staff.get(staffId)?.name || [...newPeople.values()].find(p => p.id === staffId).name
      resolved.push({ row: r, staffId, staffName, assigneeUid: staff.get(staffId)?.uid || null, times: times.value })
    }
    if (problems.length) {
      throw new TeamsError(422, 'unresolved', `${problems.length} ${problems.length === 1 ? 'row needs' : 'rows need'} attention before applying.`,
        problems.slice(0, 20).map(message => ({ code: 'unresolved', message })))
    }

    // The weeks touched, and what is already in them.
    const weeks = [...new Set(resolved.map(r => weekStartOf(r.times.date)))]
    const [weekSnaps, existingSnaps] = await Promise.all([
      Promise.all(weeks.map(w => tx.get(db.doc(paths.schedule(bizId, w))))),
      Promise.all(weeks.map(w => tx.get(db.collection(`businesses/${bizId}/shifts`).where('scheduleId', '==', w)))),
    ])
    const published = weeks.filter((w, i) => weekSnaps[i].exists && weekSnaps[i].data().status === 'published')
    if (published.length) {
      throw conflict('published', `The week of ${published.join(', ')} is already published. Imports add drafts, so remove those rows or add them by hand.`)
    }
    const existing = existingSnaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data(), startAt: d.data().startAt.toDate(), endAt: d.data().endAt.toDate() })))
      .filter(s => s.status !== 'cancelled')
    const clashes = []
    resolved.forEach((r, i) => {
      const mine = { startAt: r.times.startAt, endAt: r.times.endAt }
      if (existing.some(s => s.staffId === r.staffId && overlaps(s, mine))
        || resolved.slice(0, i).some(o => o.staffId === r.staffId && overlaps({ startAt: o.times.startAt, endAt: o.times.endAt }, mine))) {
        clashes.push(`${r.staffName} on ${r.times.date} overlaps another shift.`)
      }
    })
    if (clashes.length) {
      throw new TeamsError(422, 'overlap', `${clashes.length} ${clashes.length === 1 ? 'shift overlaps' : 'shifts overlap'} with others.`,
        clashes.slice(0, 20).map(message => ({ code: 'overlap', message })))
    }

    // ---- writes ----
    const at = Timestamp.fromDate(now)
    for (const p of newPeople.values()) {
      tx.set(db.doc(paths.staff(bizId, p.id)), { name: p.name, positionNames: [], locationIds: [], createdAt: at, source: 'import' })
    }
    weeks.forEach((w, i) => {
      if (!weekSnaps[i].exists) {
        tx.set(db.doc(paths.schedule(bizId, w)), { weekStart: w, status: 'draft', source: job.source, version: 1, createdAt: at, updatedAt: at, createdBy: uid })
      }
    })
    for (const r of resolved) {
      tx.set(db.collection(`businesses/${bizId}/shifts`).doc(), {
        scheduleId: weekStartOf(r.times.date), staffId: r.staffId, staffName: r.staffName, assigneeUid: r.assigneeUid,
        date: r.times.date, startLocal: r.times.startLocal, endLocal: r.times.endLocal, overnight: r.times.overnight,
        minutes: r.times.minutes, startAt: Timestamp.fromDate(r.times.startAt), endAt: Timestamp.fromDate(r.times.endAt),
        positionName: r.row.positionName ? String(r.row.positionName).slice(0, 40) : null, notes: null,
        published: false, status: 'scheduled', origin: `import:${job.source}`, importId,
        openOfferId: null, swapId: null, version: 1, createdAt: at, updatedAt: at,
      })
    }
    tx.update(ref, { status: 'published', appliedAt: at, appliedBy: uid, shiftsCreated: resolved.length, updatedAt: at })
    audit(tx, db, bizId, uid, 'import.applied', { importId, shifts: resolved.length, weeks, newPeople: newPeople.size }, now)
    return { created: resolved.length, weeks, newPeople: newPeople.size }
  })
}

export async function discardImport({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const importId = requireId(input.importId, 'import')
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = db.doc(paths.importJob(bizId, importId))
    const snap = await tx.get(ref)
    if (!snap.exists) return { ok: true }
    if (!canTransition('importJob', snap.data().status, 'discarded')) return { ok: true }
    tx.update(ref, { status: 'discarded', updatedAt: Timestamp.fromDate(now) })
    audit(tx, db, bizId, uid, 'import.discarded', { importId }, now)
    return { ok: true }
  })
}
