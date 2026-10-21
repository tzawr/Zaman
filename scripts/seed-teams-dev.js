import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin } from '../api/_firebase-admin.js'
import * as ws from '../api/_teams-workspaces.js'
import * as sched from '../api/_teams-schedules.js'
import * as mk from '../api/_teams-marketplace.js'
import * as av from '../api/_teams-availability.js'
import { addDays, todayIn, weekStartOf } from '../shared/teams/time.js'

// Fills the Firebase emulators with a small, realistic setup for working on
// Teams: two workplaces, a manager, and an employee who works at both. It
// refuses to run against anything but the emulators.
//
//   npm run dev:emulators   # first
//   npm run dev:seed
//
// Test accounts (emulator only, password for all: teams-dev-pass):
//   maya@example.test  owner of Blue Door Cafe
//   sam@example.test   employee at Blue Door Cafe, owner of Night Owl Bar
//   lee@example.test   employee at Blue Door Cafe

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.GCLOUD_PROJECT = 'demo-hengam'

const PASSWORD = 'teams-dev-pass'
const TZ = 'America/Los_Angeles'

initAdmin()
const db = getFirestore()
const auth = getAuth()
const now = new Date()

async function account(email, name) {
  const existing = await auth.getUserByEmail(email).catch(() => null)
  if (existing) await auth.deleteUser(existing.uid)
  const user = await auth.createUser({ email, password: PASSWORD, displayName: name, emailVerified: true })
  return { uid: user.uid, token: { uid: user.uid, email, email_verified: true, name } }
}

const run = (fn, who, input) => fn({ db, uid: who.uid, token: who.token, input, now })

await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-hengam/databases/(default)/documents`, { method: 'DELETE' })

const maya = await account('maya@example.test', 'Maya Owner')
const sam = await account('sam@example.test', 'Sam Rivera')
const lee = await account('lee@example.test', 'Lee Park')

const { bizId: cafe } = await run(ws.createBusiness, maya, { name: 'Blue Door Cafe', timezone: TZ, requestId: 'seed-cafe-0001' })
const samInvite = await run(ws.createInvite, maya, { bizId: cafe, name: 'Sam Rivera' })
await run(ws.acceptInvite, sam, { code: samInvite.code })
const leeInvite = await run(ws.createInvite, maya, { bizId: cafe, name: 'Lee Park' })
await run(ws.acceptInvite, lee, { code: leeInvite.code })
const pending = await run(ws.createInvite, maya, { bizId: cafe, name: 'Jo Bloggs' })

const { bizId: bar } = await run(ws.createBusiness, sam, { name: 'Night Owl Bar', timezone: TZ, requestId: 'seed-bar-00001' })
const samAtBar = (await db.doc(`businesses/${bar}/members/${sam.uid}`).get()).data().staffId

const today = todayIn(TZ)
const thisWeek = weekStartOf(today)
const lastWeek = addDays(thisWeek, -7)
const nextWeek = addDays(thisWeek, 7)

// Last week and this week published at the cafe; next week still a draft.
for (const week of [lastWeek, thisWeek, nextWeek]) {
  for (const [offset, staffId, start, end, positionName] of [
    [0, samInvite.staffId, '07:00', '15:00', 'Barista'],
    [1, leeInvite.staffId, '07:00', '15:00', 'Barista'],
    [2, samInvite.staffId, '11:00', '19:00', 'Floor'],
    [4, samInvite.staffId, '09:00', '13:30', 'Barista'],
    [5, leeInvite.staffId, '10:00', '18:00', 'Floor'],
  ]) {
    await run(sched.saveShift, maya, { bizId: cafe, staffId, date: addDays(week, offset), start, end, positionName })
  }
}
await run(sched.publishSchedule, maya, { bizId: cafe, weekStart: lastWeek })
await run(sched.publishSchedule, maya, { bizId: cafe, weekStart: thisWeek })

// Sam's own bar: an overnight shift this week, published.
await run(sched.saveShift, sam, { bizId: bar, staffId: samAtBar, date: addDays(thisWeek, 5), start: '20:00', end: '02:00', positionName: 'Bar' })
await run(sched.publishSchedule, sam, { bizId: bar, weekStart: thisWeek })

// Lee puts this Saturday's shift on the marketplace. Skipped late in the week,
// when that shift is already too close to trade.
const leeSaturday = (await db.collection(`businesses/${cafe}/shifts`)
  .where('staffId', '==', leeInvite.staffId).where('date', '==', addDays(thisWeek, 5)).get()).docs[0]
if (leeSaturday) {
  await run(mk.offerShift, lee, { bizId: cafe, shiftId: leeSaturday.id, note: 'Family visiting, can anyone cover?' })
    .catch(err => console.log(`Skipped Lee's offer: ${err.message}`))
}

// Availability: Sam works weekdays and Saturday mornings; Lee can't do
// Wednesdays. Lee has asked for next Friday off, which Maya has not decided.
await run(av.saveAvailability, sam, { bizId: cafe, weekly: {
  monday: { available: true, windows: [{ start: '07:00', end: '19:00' }] },
  tuesday: { available: true, windows: [{ start: '07:00', end: '19:00' }] },
  wednesday: { available: true, windows: [{ start: '07:00', end: '19:00' }] },
  thursday: { available: true, windows: [{ start: '07:00', end: '19:00' }] },
  friday: { available: true, windows: [{ start: '07:00', end: '19:00' }] },
  saturday: { available: true, windows: [{ start: '08:00', end: '13:00' }] },
}, preferredHoursPerWeek: 30 })
await run(av.saveAvailability, lee, { bizId: cafe, weekly: {
  monday: { available: true }, tuesday: { available: true }, thursday: { available: true },
  friday: { available: true }, saturday: { available: true }, sunday: { available: true },
} })
await run(av.requestTimeOff, lee, { bizId: cafe, requestId: 'seed-timeoff-0001', category: 'personal',
  startDate: addDays(nextWeek, 4), endDate: addDays(nextWeek, 4), reason: 'Moving house' })

console.log(`Seeded Blue Door Cafe (${cafe}) and Night Owl Bar (${bar}).`)
console.log(`Open invite for Jo Bloggs: ${pending.code}`)
console.log('Sign in as maya@, sam@ or lee@example.test with the password in this file.')
