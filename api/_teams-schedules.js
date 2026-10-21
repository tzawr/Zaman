import { Timestamp } from 'firebase-admin/firestore'
import { canTransition, paths } from '../shared/teams/schema.js'
import { cleanName } from '../shared/teams/workspace.js'
import {
  MAX_SHIFT_HOURS, formatDateShort, formatShiftRange, isDateString, overlaps, resolveShiftTimes, weekStartOf,
} from '../shared/teams/time.js'
import { conflict, invalid, notFound } from './_teams-http.js'
import { audit, readManager, requireId } from './_teams-common.js'
import { clearBusyBlock, readLocks, writeBusyBlock, writeReleaseLocks } from './_teams-assignments.js'

// The manager's schedule for a standalone business: one schedule document per
// week, keyed by its Monday, and one document per shift. A week starts as a
// draft only managers can see; publishing it shows every shift in it to the
// people working them. Once a week is published, changes to it go live as
// they are saved.

const MINUTE = 60 * 1000
const POSITION_MAX = 40
const NOTES_MAX = 280
// A week's shifts are published in one transaction, which Firestore caps at
// 500 writes; each shift takes two (itself and its busy-index entry).
const MAX_SHIFTS_PER_WEEK = 240

function scheduleRef(db, bizId, weekStart) {
  return db.doc(paths.schedule(bizId, weekStart))
}

// Another live shift for the same person that this one would overlap.
async function findOverlap(tx, db, bizId, staffId, window, ignoreId) {
  const snap = await tx.get(db.collection(`businesses/${bizId}/shifts`)
    .where('staffId', '==', staffId)
    .where('startAt', '>', Timestamp.fromMillis(window.startAt.getTime() - MAX_SHIFT_HOURS * 60 * MINUTE))
    .where('startAt', '<', Timestamp.fromDate(window.endAt)))
  return snap.docs.find(d => d.id !== ignoreId && d.data().status !== 'cancelled' && overlaps(
    { startAt: d.data().startAt.toDate(), endAt: d.data().endAt.toDate() }, window,
  ))
}

export async function saveShift({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const shiftId = input.shiftId ? requireId(input.shiftId, 'shift') : null
  const staffId = requireId(input.staffId, 'person')
  const positionName = cleanName(input.positionName || '', POSITION_MAX)
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, NOTES_MAX) : ''

  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const [bizSnap, staffSnap, existingSnap] = await Promise.all([
      tx.get(db.doc(paths.business(bizId))),
      tx.get(db.doc(paths.staff(bizId, staffId))),
      shiftId ? tx.get(db.doc(paths.shift(bizId, shiftId))) : Promise.resolve(null),
    ])
    if (!staffSnap.exists) throw notFound('That person is not on your team.')
    if (shiftId && !existingSnap.exists) throw notFound('That shift no longer exists.')
    const existing = existingSnap?.data()
    if (existing?.status === 'cancelled') throw conflict('shift_cancelled', 'That shift was removed.')
    // Two managers editing the same shift: the second save is refused rather
    // than silently overwriting the first.
    if (existing && input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw conflict('stale', 'Someone else changed this shift while you were editing. Reopen it to see the latest.')
    }

    const resolved = resolveShiftTimes({
      date: input.date, start: input.start, end: input.end, timezone: bizSnap.data().timezone,
    })
    if (!resolved.ok) throw invalid(resolved.message)
    const times = resolved.value

    const clash = await findOverlap(tx, db, bizId, staffId, times, shiftId)
    if (clash) {
      const c = clash.data()
      throw conflict('overlap', `${staffSnap.data().name} already works ${formatShiftRange(c)} on ${formatDateShort(c.date)}.`)
    }

    const weekStart = weekStartOf(times.date)
    const [scheduleSnap, locks] = await Promise.all([
      tx.get(scheduleRef(db, bizId, weekStart)),
      existing ? readLocks(tx, db, bizId, { id: shiftId, ...existing }) : null,
    ])
    const at = Timestamp.fromDate(now)
    const published = scheduleSnap.exists && scheduleSnap.data().status === 'published'

    if (!scheduleSnap.exists) {
      tx.set(scheduleRef(db, bizId, weekStart), {
        weekStart, status: 'draft', source: 'manual', version: 1, createdAt: at, updatedAt: at, createdBy: uid,
      })
    } else {
      tx.update(scheduleRef(db, bizId, weekStart), { updatedAt: at, version: (scheduleSnap.data().version || 0) + 1 })
    }

    const ref = shiftId ? db.doc(paths.shift(bizId, shiftId)) : db.collection(`businesses/${bizId}/shifts`).doc()
    const shift = {
      scheduleId: weekStart,
      staffId,
      staffName: staffSnap.data().name,
      assigneeUid: staffSnap.data().uid || null,
      date: times.date,
      startLocal: times.startLocal,
      endLocal: times.endLocal,
      overnight: times.overnight,
      minutes: times.minutes,
      startAt: Timestamp.fromDate(times.startAt),
      endAt: Timestamp.fromDate(times.endAt),
      positionName: positionName || null,
      notes: notes || null,
      published,
      status: 'scheduled',
      // An edit closes any offer or swap made against the old shift.
      openOfferId: null,
      swapId: null,
      origin: existing?.origin || 'manual',
      version: (existing?.version || 0) + 1,
      updatedAt: at,
      createdAt: existing?.createdAt || at,
    }
    tx.set(ref, shift)
    if (locks) writeReleaseLocks(tx, db, bizId, locks, now, 'shift_changed')
    if (existing?.assigneeUid && existing.assigneeUid !== shift.assigneeUid) clearBusyBlock(tx, db, bizId, ref.id, existing.assigneeUid)
    writeBusyBlock(tx, db, bizId, ref.id, shift)
    audit(tx, db, bizId, uid, shiftId ? 'shift.updated' : 'shift.created', {
      shiftId: ref.id, scheduleId: weekStart, staffId,
      before: existing ? { staffId: existing.staffId, date: existing.date, start: existing.startLocal, end: existing.endLocal } : null,
      after: { staffId, date: times.date, start: times.startLocal, end: times.endLocal },
    }, now)
    return { shiftId: ref.id, scheduleId: weekStart, published, version: shift.version }
  })
}

// A draft shift nobody has seen is deleted outright. A published one is
// cancelled instead, so the person who was working it can be told.
export async function deleteShift({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const shiftId = requireId(input.shiftId, 'shift')
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = db.doc(paths.shift(bizId, shiftId))
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data().status === 'cancelled') return { ok: true }
    const shift = snap.data()
    if (!canTransition('shift', shift.status, 'cancelled')) throw conflict('shift_locked', 'This shift cannot be removed.')
    const locks = await readLocks(tx, db, bizId, { id: shiftId, ...shift })
    const at = Timestamp.fromDate(now)
    if (shift.published) {
      tx.update(ref, { status: 'cancelled', cancelledAt: at, version: shift.version + 1, updatedAt: at, openOfferId: null, swapId: null })
    } else {
      tx.delete(ref)
    }
    writeReleaseLocks(tx, db, bizId, locks, now, 'shift_removed')
    clearBusyBlock(tx, db, bizId, shiftId, shift.assigneeUid)
    audit(tx, db, bizId, uid, 'shift.removed', {
      shiftId, scheduleId: shift.scheduleId, staffId: shift.staffId, published: shift.published,
    }, now)
    return { ok: true }
  })
}

export async function publishSchedule({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  if (!isDateString(input.weekStart) || weekStartOf(input.weekStart) !== input.weekStart) {
    throw invalid('Choose a week to publish.')
  }
  const weekStart = input.weekStart
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = scheduleRef(db, bizId, weekStart)
    const scheduleSnap = await tx.get(ref)
    if (!scheduleSnap.exists) throw notFound('There is nothing scheduled that week yet.')
    const schedule = scheduleSnap.data()
    if (schedule.status === 'published') return { ok: true, published: 0, alreadyPublished: true }
    if (!canTransition('schedule', schedule.status, 'published')) throw conflict('schedule_closed', 'This week can no longer be published.')

    const shiftsSnap = await tx.get(db.collection(`businesses/${bizId}/shifts`).where('scheduleId', '==', weekStart))
    const live = shiftsSnap.docs.filter(d => d.data().status !== 'cancelled')
    if (!live.length) throw invalid('Add at least one shift before publishing.')
    if (live.length > MAX_SHIFTS_PER_WEEK) throw invalid(`A week can have at most ${MAX_SHIFTS_PER_WEEK} shifts.`)

    const at = Timestamp.fromDate(now)
    live.forEach(d => {
      tx.update(d.ref, { published: true, updatedAt: at })
      writeBusyBlock(tx, db, bizId, d.id, { ...d.data(), published: true })
    })
    tx.update(ref, {
      status: 'published', publishedAt: at, publishedBy: uid, updatedAt: at, version: (schedule.version || 0) + 1,
    })
    audit(tx, db, bizId, uid, 'schedule.published', { scheduleId: weekStart, shifts: live.length }, now)
    return { ok: true, published: live.length }
  })
}
