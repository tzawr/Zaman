import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'
import { paths } from '../../shared/teams/schema.js'
import * as ws from '../../api/_teams-workspaces.js'
import * as sched from '../../api/_teams-schedules.js'
import * as mk from '../../api/_teams-marketplace.js'
import * as av from '../../api/_teams-availability.js'
import { deliver, markAllRead } from '../../api/_teams-notify.js'
import { drainPushQueue } from '../../api/_teams-push.js'
import { expireRequests, sendReminders } from '../../api/_teams-jobs.js'
import { calendarFeed, renderFeed } from '../../api/_teams-calendar.js'

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
const call = (fn, uid, input, at = now) => fn({ db, uid, token: token(uid), input, now: at })
const inbox = async (uid) => (await db.collection(`users/${uid}/notifications`).get()).docs.map(d => ({ id: d.id, ...d.data() }))
const queue = async () => (await db.collection('pushQueue').get()).docs.map(d => ({ id: d.id, ...d.data() }))

// Blue Door: owner, a manager, and two employees; this week published.
async function setup() {
  const { bizId } = await call(ws.createBusiness, 'owner', { name: 'Blue Door', timezone: 'America/Los_Angeles', requestId: 'req-notify-1' })
  const staff = {}
  for (const [name, role] of [['mgr', 'manager'], ['ana', 'employee'], ['ben', 'employee']]) {
    const inv = await call(ws.createInvite, 'owner', { bizId, name, role })
    await call(ws.acceptInvite, name, { code: inv.code })
    staff[name] = inv.staffId
  }
  const ana = (await call(sched.saveShift, 'owner', { bizId, staffId: staff.ana, date: '2026-10-21', start: '07:00', end: '15:00' })).shiftId
  const published = await call(sched.publishSchedule, 'owner', { bizId, weekStart: '2026-10-19' })
  return { bizId, staff, ana, published }
}

describe('delivery', () => {
  test('publishing tells each person on the week, once, however often it is delivered', async () => {
    const { published } = await setup()
    assert.deepEqual(published.notify.map(n => [n.kind, n.to, n.params.shiftCount]), [['schedulePublished', 'ana', 1]])
    await deliver(db, published.notify, now)
    await deliver(db, published.notify, now)
    const mine = await inbox('ana')
    assert.equal(mine.length, 1)
    assert.equal(mine[0].title, 'Blue Door: schedule is out')
    assert.equal(mine[0].readAt, null)
    assert.equal((await queue()).length, 1)
  })

  test('a redelivery does not mark a read notification unread', async () => {
    const { published } = await setup()
    await deliver(db, published.notify, now)
    const [n] = await inbox('ana')
    await db.doc(paths.notification('ana', n.id)).update({ readAt: Timestamp.fromDate(now) })
    await deliver(db, published.notify, now)
    assert.ok((await inbox('ana'))[0].readAt)
  })

  test('an offer goes to everyone else; a pickup request to managers; the decision to both sides', async () => {
    const { bizId, ana } = await setup()
    const offer = await call(mk.offerShift, 'ana', { bizId, shiftId: ana })
    await deliver(db, offer.notify, now)
    for (const uid of ['owner', 'mgr', 'ben']) assert.equal((await inbox(uid)).length, 1, uid)
    assert.equal((await inbox('ana')).length, 0, 'not told about her own offer')

    const claim = await call(mk.claimOffer, 'ben', { bizId, offerId: offer.offerId })
    await deliver(db, claim.notify, now)
    assert.ok((await inbox('mgr')).some(n => n.type === 'pickup_requested'))
    assert.ok(!(await inbox('ben')).some(n => n.type === 'pickup_requested'))

    const decided = await call(mk.decideClaim, 'mgr', { bizId, offerId: offer.offerId, claimantUid: 'ben', approve: true })
    await deliver(db, decided.notify, now)
    assert.ok((await inbox('ben')).some(n => n.title === 'Blue Door: shift is yours'))
    assert.ok((await inbox('ana')).some(n => n.title === 'Blue Door: your shift was picked up'))
  })

  test('time off: managers hear about the request, the person about the decision', async () => {
    const { bizId } = await setup()
    const req = await call(av.requestTimeOff, 'ana', { bizId, requestId: 'notify-tor-1', category: 'sick', startDate: '2026-10-23', endDate: '2026-10-23' })
    await deliver(db, req.notify, now)
    assert.ok((await inbox('owner')).some(n => n.type === 'time_off_requested'))
    assert.ok((await inbox('mgr')).some(n => n.body.startsWith('ana: Fri, Oct 23')))
    const dec = await call(av.decideTimeOff, 'owner', { bizId, timeOffId: req.id, approve: false, note: 'Short-staffed' })
    await deliver(db, dec.notify, now)
    const n = (await inbox('ana')).find(x => x.type === 'time_off_decided')
    assert.equal(n.title, 'Blue Door: time off declined')
    assert.match(n.body, /“Short-staffed”/)
  })

  test('mark all read', async () => {
    const { published } = await setup()
    await deliver(db, published.notify, now)
    assert.equal((await markAllRead({ db, uid: 'ana', now })).marked, 1)
    assert.equal((await markAllRead({ db, uid: 'ana', now })).marked, 0)
  })
})

describe('push', () => {
  test('sends to each device, forgets uninstalled ones, and records people without one', async () => {
    const { published, bizId, ana } = await setup()
    await db.doc(paths.device('ana', 'phone')).set({ platform: 'ios', token: 'ExponentPushToken[aaa]' })
    await db.doc(paths.device('ana', 'old')).set({ platform: 'android', token: 'ExponentPushToken[gone]' })
    await deliver(db, published.notify, now)
    const offer = await call(mk.offerShift, 'ana', { bizId, shiftId: ana })
    await deliver(db, offer.notify, now) // owner, mgr, ben: no devices
    const sent = []
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body)
      sent.push(...body)
      return { json: async () => ({ data: body.map(m => m.to.includes('gone') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }) }) }
    }
    const r = await drainPushQueue(db, { now, fetchImpl })
    assert.deepEqual(r, { sent: 1, failed: 0, noDevice: 3 })
    assert.equal(sent.length, 2)
    assert.equal((await db.doc(paths.device('ana', 'old')).get()).exists, false)
    assert.deepEqual(await drainPushQueue(db, { now, fetchImpl }), { sent: 0, failed: 0, noDevice: 0 })
  })
})

describe('daily job', () => {
  test('reminds people of shifts in the next day and a half, once', async () => {
    await setup() // Ana works Wed 21 Oct, 07:00 LA = 14:00Z, 21h from now
    assert.equal((await sendReminders(db, now)).reminders, 1)
    assert.equal((await sendReminders(db, now)).reminders, 1) // same key, same document
    const reminders = (await inbox('ana')).filter(n => n.type === 'shift_reminder')
    assert.equal(reminders.length, 1)
    assert.equal(reminders[0].title, 'Tomorrow at Blue Door')
  })

  test('closes offers and swaps past their deadline and frees the shifts', async () => {
    const { bizId, ana } = await setup()
    const { offerId } = await call(mk.offerShift, 'ana', { bizId, shiftId: ana })
    const later = new Date('2026-10-21T13:00:00Z') // past the 2h cut-off
    assert.deepEqual(await expireRequests(db, later), { offersExpired: 1, swapsExpired: 0 })
    assert.equal((await db.doc(paths.offer(bizId, offerId)).get()).data().status, 'expired')
    assert.equal((await db.doc(paths.shift(bizId, ana)).get()).data().openOfferId, null)
    assert.deepEqual(await expireRequests(db, later), { offersExpired: 0, swapsExpired: 0 })
  })
})

describe('calendar feed', () => {
  test('one secret URL per person, replaced on request', async () => {
    await setup()
    const a = await calendarFeed({ db, uid: 'ana', input: {}, now })
    assert.equal((await calendarFeed({ db, uid: 'ana', input: {}, now })).url, a.url)
    const b = await calendarFeed({ db, uid: 'ana', input: { rotate: true }, now })
    assert.notEqual(b.url, a.url)
    const oldToken = a.url.match(/calendar\/([a-f0-9]+)\.ics$/)[1]
    assert.equal(await renderFeed(db, oldToken, now), null)
  })

  test('lists the person’s published shifts in their current workplaces only', async () => {
    const { bizId, staff } = await setup()
    await call(sched.saveShift, 'owner', { bizId, staffId: staff.ana, date: '2026-10-27', start: '09:00', end: '13:00' }) // next week, draft
    const { url } = await calendarFeed({ db, uid: 'ana', input: {}, now })
    const tokenId = url.match(/calendar\/([a-f0-9]+)\.ics$/)[1]
    const ics = await renderFeed(db, tokenId, now)
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, 'the draft is not in it')
    assert.match(ics, /DTSTART:20261021T140000Z/)
    assert.match(ics, /SUMMARY:Blue Door/)
    await call(ws.leaveBusiness, 'ana', { bizId })
    assert.equal((await renderFeed(db, tokenId, now)).match(/BEGIN:VEVENT/g), null)
    assert.equal(await renderFeed(db, 'nope', now), null)
  })
})
