import { Timestamp } from 'firebase-admin/firestore'
import { DEFAULT_POLICIES, paths } from '../shared/teams/schema.js'
import { addDays } from '../shared/teams/time.js'
import { checkAssignment, validationWindow } from '../shared/teams/validation.js'
import { isActive } from '../shared/teams/workspace.js'
import { audit } from './_teams-common.js'

// What changing who works a shift involves, shared by the schedule editor,
// the marketplace and swaps: gathering the facts validation needs, moving the
// shift, and keeping each person's cross-workplace busy index in step.
//
// Everything here runs inside a caller's transaction. Functions named read*
// only read, and functions named write* only write, so a caller can do all
// its reads first as Firestore transactions require.

const blockId = (bizId, shiftId) => `${bizId}_${shiftId}`

export function toPlainShift(id, data) {
  return {
    id,
    ...data,
    startAt: data.startAt?.toDate?.() ?? data.startAt,
    endAt: data.endAt?.toDate?.() ?? data.endAt,
  }
}

export async function readPolicies(tx, db, bizId) {
  const snap = await tx.get(db.doc(paths.policies(bizId)))
  return { ...DEFAULT_POLICIES, ...(snap.exists ? snap.data() : {}) }
}

// The person behind a roster entry, as validation sees them.
export async function readPerson(tx, db, bizId, staffId) {
  const staffSnap = await tx.get(db.doc(paths.staff(bizId, staffId)))
  if (!staffSnap.exists) return null
  const staff = staffSnap.data()
  const memberSnap = staff.uid ? await tx.get(db.doc(paths.member(bizId, staff.uid))) : null
  return {
    staffId,
    uid: staff.uid || null,
    name: staff.name,
    positionNames: staff.positionNames || [],
    locationIds: staff.locationIds || [],
    active: Boolean(memberSnap?.exists && isActive(memberSnap.data())),
  }
}

// Everything checkAssignment needs to know about a person around a shift:
// their other shifts here, and when they are busy at their other workplaces.
export async function readFacts(tx, db, bizId, shift, person) {
  const { fromDate, toDate } = validationWindow(shift.date)
  const from = Timestamp.fromDate(new Date(`${fromDate}T00:00:00Z`))
  const to = Timestamp.fromDate(new Date(`${addDays(toDate, 1)}T00:00:00Z`))
  const [here, busy] = await Promise.all([
    tx.get(db.collection(`businesses/${bizId}/shifts`)
      .where('staffId', '==', person.staffId).where('startAt', '>=', from).where('startAt', '<', to)),
    person.uid
      ? tx.get(db.collection(`userBusy/${person.uid}/blocks`).where('startAt', '>=', from).where('startAt', '<', to))
      : Promise.resolve({ docs: [] }),
  ])
  return {
    sameBusinessShifts: here.docs.map(d => toPlainShift(d.id, d.data())),
    otherWorkplaceBlocks: busy.docs.map(d => d.data()).filter(b => b.bizId !== bizId)
      .map(b => ({ ...b, startAt: b.startAt.toDate(), endAt: b.endAt.toDate() })),
  }
}

export function check({ shift, person, facts, policies, now, audience = 'self', excludeShiftIds = [] }) {
  return checkAssignment({ shift, person, ...facts, policies, now, audience, excludeShiftIds })
}

// The busy index holds each published, live shift under the person working
// it, with nothing about the business beyond an id the server alone reads.
export function writeBusyBlock(tx, db, bizId, shiftId, shift) {
  if (!shift.assigneeUid) return
  const ref = db.doc(paths.busyBlock(shift.assigneeUid, blockId(bizId, shiftId)))
  if (shift.published && shift.status !== 'cancelled') {
    tx.set(ref, { bizId, shiftId, startAt: shift.startAt, endAt: shift.endAt })
  } else {
    tx.delete(ref)
  }
}

export function clearBusyBlock(tx, db, bizId, shiftId, uid) {
  if (uid) tx.delete(db.doc(paths.busyBlock(uid, blockId(bizId, shiftId))))
}

// Hands a shift to someone else. The shift's version moves on, so any other
// request made against the old assignment is refused when it is acted on.
export function writeTransfer(tx, db, { bizId, shiftId, shift, to, now, actorUid, action, details }) {
  const at = Timestamp.fromDate(now)
  const next = {
    staffId: to.staffId,
    staffName: to.name,
    assigneeUid: to.uid,
    version: (shift.version || 0) + 1,
    openOfferId: null,
    swapId: null,
    updatedAt: at,
  }
  tx.update(db.doc(paths.shift(bizId, shiftId)), next)
  clearBusyBlock(tx, db, bizId, shiftId, shift.assigneeUid)
  writeBusyBlock(tx, db, bizId, shiftId, {
    ...shift, ...next,
    startAt: Timestamp.fromDate(new Date(shift.startAt)), endAt: Timestamp.fromDate(new Date(shift.endAt)),
  })
  audit(tx, db, bizId, actorUid, action, {
    shiftId, fromStaffId: shift.staffId, toStaffId: to.staffId, ...details,
  }, now)
}

// A shift that is edited or removed takes its open offer and pending swap
// with it: both were asked against a shift that no longer exists as it was.
export async function readLocks(tx, db, bizId, shift) {
  const [offerSnap, claimsSnap, swapSnap] = await Promise.all([
    shift.openOfferId ? tx.get(db.doc(paths.offer(bizId, shift.openOfferId))) : null,
    shift.openOfferId
      ? tx.get(db.collection(`businesses/${bizId}/offers/${shift.openOfferId}/claims`).where('status', '==', 'pending'))
      : null,
    shift.swapId ? tx.get(db.doc(paths.swap(bizId, shift.swapId))) : null,
  ])
  const swap = swapSnap?.exists ? swapSnap.data() : null
  const otherShiftId = swap ? (swap.shiftA.id === shift.id ? swap.shiftB.id : swap.shiftA.id) : null
  return { offerSnap, claimsSnap, swapSnap, otherShiftId }
}

export function writeReleaseLocks(tx, db, bizId, locks, now, reason) {
  const at = Timestamp.fromDate(now)
  if (locks.offerSnap?.exists && ['available', 'pending'].includes(locks.offerSnap.data().status)) {
    tx.update(locks.offerSnap.ref, { status: 'cancelled', cancelledAt: at, cancelReason: reason, claimantUids: [] })
    locks.claimsSnap?.docs.forEach(d => tx.update(d.ref, { status: 'superseded', decidedAt: at }))
  }
  if (locks.swapSnap?.exists && ['pending_peer', 'pending_manager'].includes(locks.swapSnap.data().status)) {
    tx.update(locks.swapSnap.ref, { status: 'cancelled', cancelledAt: at, cancelReason: reason })
    if (locks.otherShiftId) tx.update(db.doc(paths.shift(bizId, locks.otherShiftId)), { swapId: null })
  }
}
