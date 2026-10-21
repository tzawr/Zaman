import { randomBytes } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { paths } from '../shared/teams/schema.js'
import { buildCalendar, shiftEvent } from '../shared/teams/ics.js'

// A personal calendar feed: one secret URL that Apple Calendar, Google
// Calendar or Outlook subscribe to, listing every shift the person works in
// every workplace they belong to. The token is the only credential, so it is
// long, random, and can be replaced at any time, which kills the old URL.

const DAY = 24 * 60 * 60 * 1000
export const FEED_TOKEN_RE = /^[a-f0-9]{48}$/

function feedUrl(token) {
  const base = (process.env.APP_URL || 'https://hengam.app').replace(/\/$/, '')
  return `${base}/api/calendar/${token}.ics`
}

export async function calendarFeed({ db, uid, input, now }) {
  const existing = await db.collection('calendarFeeds').where('uid', '==', uid).get()
  if (existing.docs.length && input.rotate !== true) return { url: feedUrl(existing.docs[0].id) }
  const token = randomBytes(24).toString('hex')
  const batch = db.batch()
  existing.docs.forEach(d => batch.delete(d.ref))
  batch.set(db.doc(paths.calendarFeed(token)), { uid, createdAt: Timestamp.fromDate(now) })
  await batch.commit()
  return { url: feedUrl(token), rotated: existing.docs.length > 0 }
}

// The feed itself. Shifts from the last month onwards, only for workplaces
// the person still belongs to. A shift removed in the last two weeks stays
// in as cancelled, so a calendar that already copied it takes it off.
export async function renderFeed(db, token, now = new Date()) {
  if (!FEED_TOKEN_RE.test(token)) return null
  const feed = await db.doc(paths.calendarFeed(token)).get()
  if (!feed.exists) return null
  const uid = feed.data().uid
  const [workplaces, shifts] = await Promise.all([
    db.collection(`users/${uid}/workplaces`).get(),
    db.collectionGroup('shifts')
      .where('assigneeUid', '==', uid)
      .where('startAt', '>=', Timestamp.fromMillis(now.getTime() - 30 * DAY))
      .get(),
  ])
  const names = new Map(workplaces.docs.map(d => [d.id, d.data().name]))
  const recentCutoff = now.getTime() - 14 * DAY
  const events = shifts.docs
    .map(d => ({ bizId: d.ref.parent.parent.id, shift: { id: d.id, ...d.data() } }))
    .filter(({ bizId, shift }) => names.has(bizId) && shift.published
      && (shift.status !== 'cancelled' || (shift.updatedAt?.toMillis?.() || 0) >= recentCutoff))
    .map(({ bizId, shift }) => shiftEvent({
      ...shift, startAt: shift.startAt.toDate(), endAt: shift.endAt.toDate(), updatedAt: shift.updatedAt?.toDate?.(),
    }, { bizId, workplaceName: names.get(bizId) }))
  return buildCalendar({ name: 'Hengam Teams shifts', events, now })
}
