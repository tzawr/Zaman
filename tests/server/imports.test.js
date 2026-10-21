import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'
import * as hg from '../../api/_teams-hengam.js'
import { applyImport, discardImport, importSchedule } from '../../api/_teams-imports.js'
import { MONTHLY_IMPORT_BUDGET_USD } from '../../api/_teams-extract.js'
import { workbookOf } from './_zip.js'

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
  test('a CSV becomes rows held for review, matched where it can be', async () => {
    const { bizId, staff } = await setup()
    const r = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'week.csv', mimeType: 'text/csv', data: b64(csv) })
    assert.deepEqual([r.rows, r.needsReview], [3, 2])
    const job = await readImport(bizId, r.importId)
    assert.equal(job.status, 'review')
    const [ana, ben, zed] = job.rows
    assert.deepEqual([ana.staffId, ana.match, ana.issues], [staff['Ana Lima'], 'exact', []])
    assert.deepEqual([ben.staffId, ben.match, ben.end], [staff['Ben Ortiz'], 'suggested', '17:00'])
    assert.deepEqual([zed.staffId, zed.match], [null, 'none'])
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

  test('files it cannot use are refused with the reason', async () => {
    const { bizId } = await setup()
    await rejects(call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'a.docx', data: b64('x') }), 400)
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
    beta: { messages: { stream: (params) => { record.push(params); return { finalMessage: async () => reply } } } },
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
    assert.equal(sent[0].model, 'claude-opus-5-5')
    assert.equal(sent[0].fallbacks, 'default')
    assert.equal(sent[0].messages[0].content[0].type, 'image')
    const usage = (await db.doc(`aiUsage/teams-${bizId}_2026-10`).get()).data()
    assert.equal(usage.calls, 1)
    assert.ok(Math.abs(usage.spendUsd - 0.028) < 1e-9)
  })

  test('a refusal, an over-long schedule, and a spent budget each say what to do', async () => {
    const { bizId } = await setup()
    const input = { bizId, weekStart: WEEK, fileName: 'a.pdf', mimeType: 'application/pdf', data: b64('%PDF') }
    await rejects(call(importSchedule, 'owner', input, { aiClient: fakeClaude(answer([], 'refusal')) }), 422, 'unreadable')
    await rejects(call(importSchedule, 'owner', input, { aiClient: fakeClaude(answer([], 'max_tokens')) }), 422, 'too_large')
    await db.doc(`aiUsage/teams-${bizId}_2026-10`).set({ spendUsd: MONTHLY_IMPORT_BUDGET_USD })
    let called = false
    const err = await rejects(call(importSchedule, 'owner', input, { aiClient: { beta: { messages: { stream: () => { called = true } } } } }), 429, 'budget')
    assert.equal(called, false, 'the budget is checked before calling')
    assert.match(err.message, /CSV and Excel imports still work/)
  })
})

describe('applying', () => {
  test('nothing is applied while a row is unresolved', async () => {
    const { bizId } = await setup()
    const { importId } = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    const { rows } = await readImport(bizId, importId)
    const err = await rejects(call(applyImport, 'owner', { bizId, importId, rows }), 422, 'unresolved')
    assert.match(err.problems.map(p => p.message).join(' '), /Zed Moss is not matched/)
    assert.equal((await db.collection(`businesses/${bizId}/shifts`).get()).size, 0)
  })

  test('a reviewed import adds draft shifts and new people, once', async () => {
    const { bizId } = await setup()
    const { importId } = await call(importSchedule, 'owner', { bizId, weekStart: WEEK, fileName: 'w.csv', data: b64(csv) })
    const rows = reviewed((await readImport(bizId, importId)).rows)
    const r = await call(applyImport, 'owner', { bizId, importId, rows })
    assert.deepEqual([r.created, r.weeks, r.newPeople], [3, [WEEK], 1])
    const shifts = (await db.collection(`businesses/${bizId}/shifts`).get()).docs.map(d => d.data())
    assert.ok(shifts.every(s => s.published === false && s.origin === 'import:csv'))
    assert.equal((await db.doc(paths.schedule(bizId, WEEK)).get()).data().status, 'draft')
    const staff = (await db.collection(`businesses/${bizId}/staff`).get()).docs.map(d => d.data().name)
    assert.ok(staff.includes('Zed Moss'))
    await rejects(call(applyImport, 'owner', { bizId, importId, rows }), 409, 'closed')
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
