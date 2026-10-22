import { Timestamp } from 'firebase-admin/firestore'
import { canTransition, paths } from '../shared/teams/schema.js'
import { MAX_IMPORT_ROWS, MAX_RANGE_DAYS, importWeek, interpretTable, parseCsv, placeInRange, prepareRows, readDate, rowIssues } from '../shared/teams/imports.js'
import { addDays, daysBetween, formatDateShort, formatWeekRange, isDateString, overlaps, resolveShiftTimes, weekStartOf } from '../shared/teams/time.js'
import { validatePersonName } from '../shared/teams/workspace.js'
import { TeamsError, conflict, invalid, notFound } from './_teams-http.js'
import { audit, readManager, requireId } from './_teams-common.js'
import { AI_MEDIA_TYPES, extractWithClaude } from './_teams-extract.js'
import { readDocxTables } from './_docx.js'
import { XlsxError, readXlsx } from './_xlsx.js'

// Importing a schedule a business already has. Reading a file produces an
// import held for review; nothing becomes a shift until a manager has looked
// at every row and applied it, and applying adds draft shifts that still need
// publishing. The file itself is never stored.

// Vercel caps a request body at 4.5 MB; base64 adds a third.
export const MAX_FILE_BYTES = 3 * 1024 * 1024
// One import's worth: a month of a large team's shifts.
const MAX_APPLY_ROWS = MAX_IMPORT_ROWS

function kindOf(fileName, mimeType) {
  const ext = String(fileName || '').toLowerCase().split('.').pop()
  if (ext === 'csv' || ext === 'txt' || mimeType === 'text/csv') return 'csv'
  if (ext === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (ext === 'xls') return 'xls'
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (AI_MEDIA_TYPES[mimeType] === 'image' || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'
  return null
}

const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

export async function importSchedule({ db, uid, input, now, aiClient }) {
  const bizId = requireId(input.bizId, 'workspace')
  // The days the schedule covers, chosen on a calendar. Older versions of
  // the app send only the week it starts.
  let range = null
  if (input.from !== undefined || input.to !== undefined) {
    if (!isDateString(input.from) || !isDateString(input.to) || input.to < input.from) throw invalid('Choose the first and last day this schedule covers.')
    if (daysBetween(input.from, input.to) >= MAX_RANGE_DAYS) throw invalid(`Choose at most ${MAX_RANGE_DAYS} days. Import a longer schedule in parts.`)
    range = { from: input.from, to: input.to }
  } else if (!isDateString(input.weekStart) || weekStartOf(input.weekStart) !== input.weekStart) {
    throw invalid('Choose the week this schedule is for.')
  }
  const weekStart = range ? weekStartOf(range.from) : input.weekStart
  const fileName = String(input.fileName || 'schedule').slice(0, 120)
  const kind = kindOf(fileName, input.mimeType)
  if (!kind) throw invalid('Upload a Word (.docx), Excel (.xlsx) or CSV file, a PDF, or a photo of the schedule.')
  if (kind === 'xls') throw invalid('Older .xls files are not supported. Save it as .xlsx or CSV and try again.')
  if (kind === 'doc') throw invalid('Older .doc files are not supported. Save it as .docx or PDF and try again.')
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
  if (kind === 'csv' || kind === 'xlsx' || kind === 'docx') {
    // Files we can read ourselves, at no cost: no AI involved.
    let tables
    try {
      tables = kind === 'csv' ? [parseCsv(bytes.toString('utf8'))]
        : kind === 'xlsx' ? [readXlsx(bytes)]
          : readDocxTables(bytes)
    } catch (err) {
      if (err instanceof XlsxError) throw invalid(err.message)
      throw err
    }
    if (!tables.length) throw invalid('This Word file has no table in it. Save it as a PDF, or take a photo of the schedule, and try again.')
    // A Word file often holds one table per week. Days named only by weekday
    // in a later table belong to the week after the one before it.
    const reads = tables.map((table, i) => interpretTable(table, { weekStart: addDays(weekStart, 7 * i), year: Number(weekStart.slice(0, 4)) }))
    const found = reads.filter(r => r.rows.length)
    if (!found.length) {
      const problems = [...new Set(reads.flatMap(r => r.problems))]
      if (!problems.length) problems.push('No shifts were found in this file.')
      throw new TeamsError(422, 'unreadable', problems.join(' '), problems.map(message => ({ code: 'unreadable', message })))
    }
    extracted = found.flatMap(r => r.rows)
    layout = found[0].layout
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

  if (extracted.length > MAX_IMPORT_ROWS) {
    notes = [notes, `This file has ${extracted.length} shifts. The first ${MAX_IMPORT_ROWS} were read; import the rest as a second file.`].filter(Boolean).join(' ')
  }
  let rows = prepareRows(extracted, staff)
  if (range) {
    const placed = placeInRange(rows, range)
    rows = placed.rows
    const weeks = Math.round(Math.abs(placed.movedByDays) / 7)
    if (weeks) notes = [notes, `The file’s dates didn’t match the dates you chose, so its shifts were moved ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ${placed.movedByDays > 0 ? 'later' : 'earlier'} to start ${formatDateShort(range.from)}.`].filter(Boolean).join(' ')
    if (placed.leftOut) notes = [notes, `${placed.leftOut} ${placed.leftOut === 1 ? 'shift falls' : 'shifts fall'} outside your dates and ${placed.leftOut === 1 ? 'was' : 'were'} left out. Change the dates to bring ${placed.leftOut === 1 ? 'it' : 'them'} in.`].filter(Boolean).join(' ')
  }
  const ref = db.collection(`businesses/${bizId}/imports`).doc()
  const at = Timestamp.fromDate(now)
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      status: 'review', source: kind, fileName, weekStart, from: range?.from || null, to: range?.to || null, layout, notes: notes || null,
      rows, week: importWeek(rows.filter(r => r.include)), createdBy: uid, createdAt: at, updatedAt: at,
    })
    audit(tx, db, bizId, uid, 'import.read', { importId: ref.id, source: kind, rows: rows.length }, now)
  })
  return { importId: ref.id, rows: rows.filter(r => r.include).length, needsReview: rows.filter(r => r.include && r.issues.length).length }
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
    // The weeks it filled, so the import can always be traced to its shifts.
    weeks.sort()
    tx.update(ref, { status: 'published', appliedAt: at, appliedBy: uid, shiftsCreated: resolved.length, weeks, updatedAt: at })
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

// Takes an applied import back off the schedule: every shift it added is
// removed, and a week left with nothing in it goes too. Only while those
// weeks are drafts; once a week is published the team has seen it, so its
// shifts are changed one by one instead. People the import added to the team
// stay, as they may well be the right people.
export async function undoImport({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const importId = requireId(input.importId, 'import')
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = db.doc(paths.importJob(bizId, importId))
    const snap = await tx.get(ref)
    if (!snap.exists) throw notFound('That import no longer exists.')
    if (!canTransition('importJob', snap.data().status, 'undone')) {
      throw conflict('closed', snap.data().status === 'undone' ? 'This import was already undone.' : 'Only an import that was added can be undone.')
    }
    const shiftsSnap = await tx.get(db.collection(`businesses/${bizId}/shifts`).where('importId', '==', importId))
    const weeks = [...new Set(shiftsSnap.docs.map(d => d.data().scheduleId))].sort()
    const [weekSnaps, weekShifts] = await Promise.all([
      Promise.all(weeks.map(w => tx.get(db.doc(paths.schedule(bizId, w))))),
      Promise.all(weeks.map(w => tx.get(db.collection(`businesses/${bizId}/shifts`).where('scheduleId', '==', w)))),
    ])
    const published = weeks.filter((w, i) => weekSnaps[i].exists && weekSnaps[i].data().status === 'published')
    if (published.length) {
      throw conflict('published', `${published.length === 1 ? 'The week of' : 'The weeks of'} ${published.map(formatWeekRange).join(', ')} ${published.length === 1 ? 'is' : 'are'} already published, so the team has seen ${published.length === 1 ? 'it' : 'them'}. Remove those shifts one by one instead.`)
    }

    // ---- writes ----
    shiftsSnap.docs.forEach(d => tx.delete(d.ref))
    weeks.forEach((w, i) => {
      const others = weekShifts[i].docs.filter(d => d.data().importId !== importId)
      if (weekSnaps[i].exists && !others.length) tx.delete(weekSnaps[i].ref)
    })
    const at = Timestamp.fromDate(now)
    tx.update(ref, { status: 'undone', undoneAt: at, undoneBy: uid, shiftsRemoved: shiftsSnap.size, updatedAt: at })
    audit(tx, db, bizId, uid, 'import.undone', { importId, shifts: shiftsSnap.size, weeks }, now)
    return { removed: shiftsSnap.size, weeks }
  })
}

// Moves an applied import to other weeks: every shift it added shifts by the
// same whole number of weeks, so Mondays stay Mondays, and its times are
// worked out again for the new dates (clock changes included). Only while
// the weeks it leaves and the weeks it lands in are drafts, and only if no
// one would end up working two shifts at once.
export async function moveImport({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const importId = requireId(input.importId, 'import')
  if (!isDateString(input.toWeek) || weekStartOf(input.toWeek) !== input.toWeek) throw invalid('Choose the week it should start in.')
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = db.doc(paths.importJob(bizId, importId))
    const [snap, bizSnap] = await Promise.all([tx.get(ref), tx.get(db.doc(paths.business(bizId)))])
    if (!snap.exists) throw notFound('That import no longer exists.')
    if (snap.data().status !== 'published') throw conflict('closed', 'Only an import that was added can be moved.')
    const timezone = bizSnap.data().timezone
    const mine = (await tx.get(db.collection(`businesses/${bizId}/shifts`).where('importId', '==', importId))).docs
      .filter(d => d.data().status !== 'cancelled')
    if (!mine.length) throw conflict('empty', 'None of this import’s shifts are on the schedule any more.')

    const fromWeeks = [...new Set(mine.map(d => d.data().scheduleId))].sort()
    const byDays = daysBetween(fromWeeks[0], input.toWeek)
    if (!byDays) return { moved: 0, weeks: fromWeeks }
    if (Math.abs(byDays) > 7 * 52) throw invalid('Move it at most a year.')

    // Each shift at its new date, with its times worked out again there.
    const moved = mine.map(d => {
      const s = d.data()
      const date = addDays(s.date, byDays)
      const times = resolveShiftTimes({ date, start: s.startLocal, end: s.endLocal, timezone })
      if (!times.ok) throw invalid(`${s.staffName} on ${formatDateShort(date)}: ${times.message}`)
      return { ref: d.ref, data: s, date, times: times.value, week: weekStartOf(date) }
    })
    const toWeeks = [...new Set(moved.map(m => m.week))].sort()
    const allWeeks = [...new Set([...fromWeeks, ...toWeeks])].sort()
    const [weekSnaps, weekShifts] = await Promise.all([
      Promise.all(allWeeks.map(w => tx.get(db.doc(paths.schedule(bizId, w))))),
      Promise.all(allWeeks.map(w => tx.get(db.collection(`businesses/${bizId}/shifts`).where('scheduleId', '==', w)))),
    ])
    const weekDoc = Object.fromEntries(allWeeks.map((w, i) => [w, weekSnaps[i]]))
    const published = allWeeks.filter(w => weekDoc[w].exists && weekDoc[w].data().status === 'published')
    if (published.length) {
      throw conflict('published', `The week of ${published.map(formatWeekRange).join(', ')} is published, so the team has seen it. Move only between draft weeks.`)
    }
    // Shifts already in those weeks that are not part of this import.
    const others = weekShifts.flatMap(q => q.docs).filter(d => d.data().importId !== importId && d.data().status !== 'cancelled')
      .map(d => ({ ...d.data(), startAt: d.data().startAt.toDate(), endAt: d.data().endAt.toDate() }))
    const clashes = moved.filter(m => others.some(o => o.staffId === m.data.staffId
      && overlaps(o, { startAt: m.times.startAt, endAt: m.times.endAt })))
    if (clashes.length) {
      throw new TeamsError(422, 'overlap', `${clashes.length} ${clashes.length === 1 ? 'shift would overlap' : 'shifts would overlap'} with shifts already there.`,
        clashes.slice(0, 20).map(m => ({ code: 'overlap', message: `${m.data.staffName} on ${formatDateShort(m.date)}` })))
    }

    // ---- writes ----
    const at = Timestamp.fromDate(now)
    for (const m of moved) {
      tx.update(m.ref, {
        date: m.date, scheduleId: m.week, startLocal: m.times.startLocal, endLocal: m.times.endLocal, overnight: m.times.overnight,
        minutes: m.times.minutes, startAt: Timestamp.fromDate(m.times.startAt), endAt: Timestamp.fromDate(m.times.endAt),
        version: (m.data.version || 1) + 1, updatedAt: at,
      })
    }
    for (const w of toWeeks) {
      if (!weekDoc[w].exists) tx.set(weekDoc[w].ref, { weekStart: w, status: 'draft', source: snap.data().source, version: 1, createdAt: at, updatedAt: at, createdBy: uid })
    }
    // A week the import leaves with nothing else in it goes.
    for (const w of fromWeeks) {
      if (!toWeeks.includes(w) && weekDoc[w].exists && !others.some(o => o.scheduleId === w)) tx.delete(weekDoc[w].ref)
    }
    tx.update(ref, { weeks: toWeeks, movedAt: at, updatedAt: at })
    audit(tx, db, bizId, uid, 'import.moved', { importId, byDays, from: fromWeeks, to: toWeeks }, now)
    return { moved: moved.length, weeks: toWeeks }
  })
}
