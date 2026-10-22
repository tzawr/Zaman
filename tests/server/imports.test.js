import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'
import * as hg from '../../api/_teams-hengam.js'
import { applyImport, discardImport, importSchedule, moveImport, undoImport } from '../../api/_teams-imports.js'
import { MONTHLY_IMPORT_BUDGET_USD } from '../../api/_teams-extract.js'
import { workbookOf, zip } from './_zip.js'

const PROJECT_ID = 'demo-hengam'
let db
before(() => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID })
  db = getFirestore()
})
after(async () => { await Promise.all(getApps().map(deleteApp)) })
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
})

const now = new Date('2026-10-20T17:00:00Z')
const token = (uid) => ({ uid, email: `${uid}@x.test`, email_verified: true, name: uid })
const call = (fn, uid, input, extra = {}) => fn({ db, uid, token: token(uid), input, now, ...extra })
const b64 = (s) => Buffer.from(s).toString('base64')
const WEEK = '2026-10-26'

async function rejects(promise, status, reason) {
  let caught
  await assert.rejects(promise, (err) => { assert.equal(err.status, status, err.message); if (reason) assert.equal(err.reason, reason); caught = err; return true })
  return caught
}

async function setup() {
  const { bizId } = await call(ws.createBusiness, 'owner', { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: 'req-import-1' })
  const staff = {}
  for (const name of ['Ana Lima', 'Ben Ortiz']) staff[name] = (await call(ws.createInvite, 'owner', { bizId, name })).staffId
  return { bizId, staff }
}

const csv = [
  'Employee,Date,Start,End,Role',
  'Ana Lima,2026-10-26,7:00,15:00,Barista',
  'Ben,2026-10-27,9,5,',
  'Zed Moss,2026-10-28,10:00,18:00,Floor',
].join('\n')

const readImport = async (bizId, id) => (await db.doc(paths.importJob(bizId, id)).get()).data()

// Accepts every row as reviewed: suggestions confirmed, unknown people added.
const reviewed = (rows) => rows.map(r => ({ ...r, staffId: r.staffId || 'new', confirmed: true }))

describe('reading a file', () => {
  test('a CSV becomes rows for review, matched where it can be and new names added', async () => {
    const { bizId, staff } = await setup()
    const r = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'week.csv', mimeType: 'text/csv', data: b64(csv) })
    assert.deepEqual([r.rows, r.needsReview], [3, 0])
    const job = await readImport(bizId, r.importId)
    assert.equal(job.status, 'review')
    const [ana, ben, zed] = job.rows
    assert.deepEqual([ana.staffId, ana.match, ana.issues], [staff['Ana Lima'], 'exact', []])
    assert.deepEqual([ben.staffId, ben.match, ben.end], [staff['Ben Ortiz'], 'suggested', '17:00'])
    assert.deepEqual([zed.staffId, zed.match], ['new', 'new'])
    assert.equal((await db.collection(`businesses/${bizId}/shifts`).get()).size, 0, 'nothing is a shift yet')
  })

  test('an Excel grid reads the same way', async () => {
    const { bizId } = await setup()
    const file = workbookOf([['Staff', 'Mon', 'Tue', 'Wed'], ['Ana Lima', '9am-5pm', 'OFF', '7:00-15:00']])
    const r = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'roster.xlsx', data: file.toString('base64') })
    const job = await readImport(bizId, r.importId)
    assert.equal(job.layout, 'grid')
    assert.deepEqual(job.rows.map(x => [x.date, x.start, x.end]), [['2026-10-26', '09:00', '17:00'], ['2026-10-28', '07:00', '15:00']])
  })

  test('a Word file with a table per week reads both weeks, free', async () => {
    const { bizId } = await setup()
    const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`
    const table = (...rows) => `<w:tbl>${rows.map(r => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`
    const file = zip({ 'word/document.xml': `<w:document><w:body>${
      table(['Name', 'Mon', 'Tue', 'Wed'], ['Ana Lima', '10:30a-7p', 'OFF', ''])}${table(['Name', 'Mon', 'Tue', 'Wed'], ['Ana Lima', '', '6a-2p', ''])}</w:body></w:document>` })
    const r = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'Promenade.docx', data: file.toString('base64') })
    const job = await readImport(bizId, r.importId)
    assert.equal(job.source, 'docx')
    assert.deepEqual(job.rows.map(x => [x.date, x.start, x.end]), [['2026-10-26', '10:30', '19:00'], ['2026-11-03', '06:00', '14:00']])
    assert.equal((await db.doc(`aiUsage/teams-${bizId}_2026-10`).get()).exists, false, 'no AI, no spend')
  })

  test('a file for other dates lands in the dates chosen on the calendar', async () => {
    const { bizId } = await setup()
    const sept = ['Employee,Date,Start,End', 'Ana Lima,2026-09-07,7:00,15:00', 'Ana Lima,2026-09-21,7:00,15:00'].join('\n')
    const r = await call(importSchedule, 'owner', { bizId, from: '2026-10-19', to: '2026-11-01', fileName: 'Prom 9.7-9.20.docx.csv', data: b64(sept) })
    const job = await readImport(bizId, r.importId)
    assert.deepEqual([job.from, job.to, r.rows], ['2026-10-19', '2026-11-01', 1])
    assert.deepEqual(job.rows.map(x => [x.fileDate, x.date, x.include]), [['2026-09-07', '2026-10-19', true], ['2026-09-21', '2026-11-02', false]])
    assert.match(job.notes, /moved 6 weeks later to start Mon, Oct 19/)
    assert.match(job.notes, /1 shift falls outside your dates/)
    await rejects(call(importSchedule, 'owner', { bizId, from: '2026-10-19', to: '2027-01-30', fileName: 'w.csv', data: b64(csv) }), 400)
    await rejects(call(importSchedule, 'owner', { bizId, from: '2026-11-01', to: '2026-10-19', fileName: 'w.csv', data: b64(csv) }), 400)
  })

  test('files it cannot use are refused with the reason', async () => {
    const { bizId } = await setup()
    await rejects(call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'a.docx', data: b64('x') }), 400)
    await rejects(call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'a.doc', data: b64('x') }), 400)
    await rejects(call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'a.xls', data: b64('x') }), 400)
    const err = await rejects(call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'a.csv', data: b64('hello,world') }), 422, 'unreadable')
    assert.match(err.message, /header row/)
    await rejects(call(importSchedule, 'owner', { bizId, weekStart: '2026-10-27', fileName: 'a.csv', data: b64(csv) }), 400)
  })

  test('only managers import, and not into a Hengam workspace', async () => {
    const { bizId } = await setup()
    await rejects(call(importSchedule, 'stranger', { bizId, weekStart: WEEK, fileName: 'a.csv', data: b64(csv) }), 404)
    await db.doc('users/mgr').set({ businessName: 'H' })
    const { bizId: hBiz } = await call(hg.hengamConnect, 'mgr', { timezone: 'UTC' })
    await rejects(call(importSchedule, 'mgr', { bizId: hBiz, weekStart: WEEK, fileName: 'a.csv', data: b64(csv) }), 409, 'hengam_owned')
  })
})

describe('reading a photo or PDF', () => {
  const fakeClaude = (reply, record = []) => ({
    messages: { stream: (params) => { record.push(params); return { finalMessage: async () => reply } } },
  })
  const answer = (shifts, stop = 'end_turn') => ({
    stop_reason: stop,
    usage: { input_tokens: 2000, output_tokens: 1000 },
    content: [{ type: 'text', text: JSON.stringify({ shifts, notes: 'Bottom row was smudged.' }) }],
  })

  test('Claude’s rows arrive with its doubts marked, and spend is recorded', async () => {
    const { bizId } = await setup()
    const sent = []
    const client = fakeClaude(answer([
      { employee: 'Ana Lima', date: '', weekday: 'Tuesday', start: '07:00', end: '15:00', position: '', location: '', unclear: [] },
      { employee: 'Bne', date: '2026-10-29', weekday: '', start: '09:00', end: '13:00', position: '', location: '', unclear: ['employee'] },
    ]), sent)
    const r = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'photo.jpg', mimeType: 'image/jpeg', data: b64('jpegbytes') }, { aiClient: client })
    const job = await readImport(bizId, r.importId)
    assert.equal(job.rows[0].date, '2026-10-27', 'a weekday lands in the chosen week')
    assert.equal(job.rows[1].sure.name, false)
    assert.equal(job.notes, 'Bottom row was smudged.')
    assert.equal(sent[0].model, 'claude-haiku-5-5')
    assert.equal(sent[0].fallbacks, undefined, 'Haiku takes no server-side fallback')
    assert.equal(sent[0].output_config.effort, 'low')
    assert.equal(sent[0].messages[0].content[0].type, 'image')
    const usage = (await db.doc(`aiUsage/teams-${bizId}_2026-10`).get()).data()
    assert.equal(usage.calls, 1)
    // 2,000 in and 1,000 out on Haiku: seven hundredths of a cent.
    assert.ok(Math.abs(usage.spendUsd - 0.0007) < 1e-9)
  })

  test('a refusal, an over-long schedule, and a spent budget each say what to do', async () => {
    const { bizId } = await setup()
    const input = { bizId, weekStart: WEEK, fileName: 'a.pdf', mimeType: 'application/pdf', data: b64('%PDF') }
    await rejects(call(importSchedule, 'owner', input, { aiClient: fakeClaude(answer([], 'refusal')) }), 422, 'unreadable')
    await rejects(call(importSchedule, 'owner', input, { aiClient: fakeClaude(answer([], 'max_tokens')) }), 422, 'too_large')
    await db.doc(`aiUsage/teams-${bizId}_2026-10`).set({ spendUsd: MONTHLY_IMPORT_BUDGET_USD })
    let called = false
    const err = await rejects(call(importSchedule, 'owner', input, { aiClient: { messages: { stream: () => { called = true } } } }), 429, 'budget')
    assert.equal(called, false, 'the budget is checked before calling')
    assert.match(err.message, /Word, Excel and CSV imports still work/)
  })
})

describe('applying', () => {
  test('nothing is applied while a row is unresolved', async () => {
    const { bizId } = await setup()
    const { importId } = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    // The manager left Zed without a person.
    const rows = (await readImport(bizId, importId)).rows.map(r => (r.name === 'Zed Moss' ? { ...r, staffId: null } : r))
    const err = await rejects(call(applyImport, 'owner', { bizId, importId, rows }), 422, 'unresolved')
    assert.match(err.problems.map(p => p.message).join(' '), /Zed Moss is not matched/)
    assert.equal((await db.collection(`businesses/${bizId}/shifts`).get()).size, 0)
  })

  test('an import adds draft shifts and new people in one step, once', async () => {
    const { bizId } = await setup()
    const { importId } = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    // Exactly as read: nothing to resolve first.
    const { rows } = await readImport(bizId, importId)
    const r = await call(applyImport, 'owner', { bizId, importId, rows })
    assert.deepEqual([r.created, r.weeks, r.newPeople], [3, [WEEK], 1])
    const shifts = (await db.collection(`businesses/${bizId}/shifts`).get()).docs.map(d => d.data())
    assert.ok(shifts.every(s => s.published === false && s.origin === 'import:csv'))
    assert.equal((await db.doc(paths.schedule(bizId, WEEK)).get()).data().status, 'draft')
    const staff = (await db.collection(`businesses/${bizId}/staff`).get()).docs.map(d => d.data().name)
    assert.ok(staff.includes('Zed Moss'))
    await rejects(call(applyImport, 'owner', { bizId, importId, rows }), 409, 'closed')
  })

  test('a month for a big team imports and applies in one go, and the import knows its weeks', async () => {
    const { bizId } = await setup()
    const lines = ['Employee,Date,Start,End']
    for (let p = 0; p < 25; p++) {
      for (let d = 0; d < 28; d++) {
        if (d % 7 === 6 || d % 7 === 5) continue // weekends off: 20 shifts each
        const day = new Date(Date.UTC(2026, 9, 26 + d)).toISOString().slice(0, 10)
        lines.push(`Person ${String.fromCharCode(65 + p)},${day},9:00,17:00`)
      }
    }
    const { importId, rows } = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'november.csv', data: b64(lines.join('\n')) })
    assert.equal(rows, 500)
    const job = await readImport(bizId, importId)
    const r = await call(applyImport, 'owner', { bizId, importId, rows: job.rows })
    assert.deepEqual([r.created, r.newPeople], [500, 25])
    assert.deepEqual(r.weeks, ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'])
    assert.deepEqual((await readImport(bizId, importId)).weeks, r.weeks)
    assert.equal((await db.collection(`businesses/${bizId}/shifts`).where('importId', '==', importId).get()).size, 500)
  })

  test('published weeks and overlapping shifts are refused, with nothing written', async () => {
    const { bizId, staff } = await setup()
    await call(sched.saveShift, 'owner', { bizId, staffId: staff['Ana Lima'], date: '2026-10-26', start: '10:00', end: '12:00' })
    const { importId } = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    const rows = reviewed((await readImport(bizId, importId)).rows)
    const err = await rejects(call(applyImport, 'owner', { bizId, importId, rows }), 422, 'overlap')
    assert.match(err.problems[0].message, /Ana Lima on 2026-10-26 overlaps/)
    await call(sched.publishSchedule, 'owner', { bizId, weekStart: WEEK })
    await rejects(call(applyImport, 'owner', { bizId, importId, rows: rows.slice(1) }), 409, 'published')
    assert.equal((await db.collection(`businesses/${bizId}/shifts`).get()).size, 1)
    await call(discardImport, 'owner', { bizId, importId })
    assert.equal((await readImport(bizId, importId)).status, 'discarded')
  })
})

describe('undoing an import', () => {
  test('removes only the import’s shifts, keeps weeks with other shifts, and happens once', async () => {
    const { bizId, staff } = await setup()
    // A shift the manager added by hand, in a week the import also fills.
    await call(sched.saveShift, 'owner', { bizId, staffId: staff['Ben Ortiz'], date: '2026-10-29', start: '18:00', end: '22:00' })
    const { importId } = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    await call(applyImport, 'owner', { bizId, importId, rows: (await readImport(bizId, importId)).rows })
    assert.equal((await db.collection(`businesses/${bizId}/shifts`).get()).size, 4)

    await rejects(call(undoImport, 'stranger', { bizId, importId }), 404)
    const r = await call(undoImport, 'owner', { bizId, importId })
    assert.deepEqual(r, { removed: 3, weeks: [WEEK] })
    const left = (await db.collection(`businesses/${bizId}/shifts`).get()).docs.map(d => d.data())
    assert.deepEqual(left.map(s => [s.staffName, s.date]), [['Ben Ortiz', '2026-10-29']])
    assert.ok((await db.doc(paths.schedule(bizId, WEEK)).get()).exists, 'the week keeps its hand-added shift')
    const job = await readImport(bizId, importId)
    assert.deepEqual([job.status, job.shiftsRemoved], ['undone', 3])
    await rejects(call(undoImport, 'owner', { bizId, importId }), 409, 'closed')
  })

  test('a week left empty goes too; a published week is refused with nothing removed', async () => {
    const { bizId } = await setup()
    const first = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    await call(applyImport, 'owner', { bizId, importId: first.importId, rows: (await readImport(bizId, first.importId)).rows })
    await call(undoImport, 'owner', { bizId, importId: first.importId })
    assert.equal((await db.doc(paths.schedule(bizId, WEEK)).get()).exists, false)

    const second = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    await call(applyImport, 'owner', { bizId, importId: second.importId, rows: (await readImport(bizId, second.importId)).rows })
    await call(sched.publishSchedule, 'owner', { bizId, weekStart: WEEK })
    const err = await rejects(call(undoImport, 'owner', { bizId, importId: second.importId }), 409, 'published')
    assert.match(err.message, /already published/)
    assert.equal((await db.collection(`businesses/${bizId}/shifts`).get()).size, 3)
    assert.equal((await readImport(bizId, second.importId)).status, 'published')
  })
})

describe('moving an import', () => {
  const applied = async () => {
    const ctx = await setup()
    const { importId } = await call(importSchedule, 'owner', { bizId: ctx.bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    await call(applyImport, 'owner', { bizId: ctx.bizId, importId, rows: (await readImport(ctx.bizId, importId)).rows })
    return { ...ctx, importId }
  }

  test('moves every shift by whole weeks, times kept, and the empty week goes', async () => {
    const { bizId, importId } = await applied()
    const r = await call(moveImport, 'owner', { bizId, importId, toWeek: '2026-11-09' })
    assert.deepEqual(r, { moved: 3, weeks: ['2026-11-09'] })
    const shifts = (await db.collection(`businesses/${bizId}/shifts`).get()).docs.map(d => d.data()).sort((a, b) => a.date.localeCompare(b.date))
    assert.deepEqual(shifts.map(s => [s.date, s.startLocal, s.endLocal, s.scheduleId]), [
      ['2026-11-09', '07:00', '15:00', '2026-11-09'], ['2026-11-10', '09:00', '17:00', '2026-11-09'], ['2026-11-11', '10:00', '18:00', '2026-11-09'],
    ])
    // Pacific time fell back on Nov 1: the instant follows the local time.
    assert.equal(shifts[0].startAt.toDate().toISOString(), '2026-11-09T15:00:00.000Z')
    assert.equal((await db.doc(paths.schedule(bizId, WEEK)).get()).exists, false)
    assert.equal((await db.doc(paths.schedule(bizId, '2026-11-09')).get()).data().status, 'draft')
    assert.deepEqual((await readImport(bizId, importId)).weeks, ['2026-11-09'])
  })

  test('refuses published weeks and clashes, changing nothing', async () => {
    const { bizId, importId, staff } = await applied()
    await call(sched.saveShift, 'owner', { bizId, staffId: staff['Ana Lima'], date: '2026-11-16', start: '06:00', end: '09:00' })
    const clash = await rejects(call(moveImport, 'owner', { bizId, importId, toWeek: '2026-11-16' }), 422, 'overlap')
    assert.match(clash.problems[0].message, /Ana Lima/)
    await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-11-16' })
    await rejects(call(moveImport, 'owner', { bizId, importId, toWeek: '2026-11-16' }), 409, 'published')
    await rejects(call(moveImport, 'owner', { bizId, importId, toWeek: '2026-11-17' }), 400)
    const dates = (await db.collection(`businesses/${bizId}/shifts`).where('importId', '==', importId).get()).docs.map(d => d.data().date).sort()
    assert.deepEqual(dates, ['2026-10-26', '2026-10-27', '2026-10-28'])
  })
})
