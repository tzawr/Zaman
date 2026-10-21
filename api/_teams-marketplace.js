import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { canTransition, paths } from '../shared/teams/schema.js'
import { checkAssignment } from '../shared/teams/validation.js'
import { isManagerRole } from '../shared/teams/workspace.js'
import { TeamsError, conflict, forbidden, ineligible, invalid, notFound } from './_teams-http.js'
import { audit, readActor, readManager, requireId } from './_teams-common.js'
import { check, readFacts, readPerson, readPolicies, toPlainShift, writeTransfer } from './_teams-assignments.js'

// The shift marketplace and direct swaps. A shift stays with its owner until
// the transaction that completes a transfer; every request records the shift
// version it was made against, and is refused if the shift moved on since.
// Validation runs when a request is made and again when it is approved, with
// whatever has changed in between.

const NOTE_MAX = 280
const HOUR = 60 * 60 * 1000
const SWAP_HORIZON_DAYS = 28

function cleanNote(value) {
  return typeof value === 'string' ? value.trim().slice(0, NOTE_MAX) : ''
}

function snapshotOf(shift) {
  return {
    id: shift.id, date: shift.date, startLocal: shift.startLocal, endLocal: shift.endLocal,
    overnight: Boolean(shift.overnight), minutes: shift.minutes, positionName: shift.positionName || null,
    startAt: Timestamp.fromDate(new Date(shift.startAt)), endAt: Timestamp.fromDate(new Date(shift.endAt)),
    staffName: shift.staffName,
  }
}

async function readShift(tx, db, bizId, shiftId) {
  const snap = await tx.get(db.doc(paths.shift(bizId, shiftId)))
  if (!snap.exists) throw notFound('That shift is no longer on the schedule.')
  return toPlainShift(snap.id, snap.data())
}

// A shift someone can hand on: published, live, and still in the future.
function requireTradable(shift, policies, now, whose = 'This shift') {
  if (!shift.published || shift.status === 'cancelled') throw conflict('not_tradable', `${whose} is not on the published schedule.`)
  const timing = checkAssignment({ shift, person: { name: '', uid: 'x', active: true }, policies, now }).problems
    .filter(p => p.code === 'started' || p.code === 'too_late')
  if (timing.length) throw ineligible(timing)
}

// ---- Offering a shift -------------------------------------------------------

export async function offerShift({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const shiftId = requireId(input.shiftId, 'shift')
  const note = cleanNote(input.note)
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const [shift, policies] = await Promise.all([readShift(tx, db, bizId, shiftId), readPolicies(tx, db, bizId)])
    if (shift.assigneeUid !== uid) throw forbidden('You can only offer your own shifts.')
    requireTradable(shift, policies, now)
    if (shift.openOfferId) return { offerId: shift.openOfferId, alreadyOffered: true }
    if (shift.swapId) throw conflict('locked', 'This shift is part of a swap request. Cancel the swap first.')

    const ref = db.collection(`businesses/${bizId}/offers`).doc()
    const at = Timestamp.fromDate(now)
    tx.set(ref, {
      shiftId, shiftVersion: shift.version, shift: snapshotOf(shift),
      offeredByUid: uid, offeredByName: shift.staffName || actor.displayName, note: note || null,
      status: 'available', requiresApproval: Boolean(policies.pickupRequiresApproval),
      claimantUids: [],
      expiresAt: Timestamp.fromMillis(new Date(shift.startAt).getTime() - (policies.offerCutoffHours || 0) * HOUR),
      createdAt: at, updatedAt: at,
    })
    tx.update(db.doc(paths.shift(bizId, shiftId)), { openOfferId: ref.id })
    audit(tx, db, bizId, uid, 'offer.created', { offerId: ref.id, shiftId }, now)
    return { offerId: ref.id }
  })
}

async function readOffer(tx, db, bizId, offerId) {
  const snap = await tx.get(db.doc(paths.offer(bizId, offerId)))
  if (!snap.exists) throw notFound('That offer no longer exists.')
  return snap.data()
}

async function readPendingClaims(tx, db, bizId, offerId) {
  return tx.get(db.collection(`businesses/${bizId}/offers/${offerId}/claims`).where('status', '==', 'pending'))
}

export async function cancelOffer({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const offerId = requireId(input.offerId, 'offer')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const offer = await readOffer(tx, db, bizId, offerId)
    if (offer.offeredByUid !== uid && !isManagerRole(actor.role)) throw forbidden('Only the person who offered this shift can cancel it.')
    if (!canTransition('offer', offer.status, 'cancelled')) throw conflict('closed', 'This offer is already closed.')
    const [claims, shiftSnap] = await Promise.all([
      readPendingClaims(tx, db, bizId, offerId),
      tx.get(db.doc(paths.shift(bizId, offer.shiftId))),
    ])
    const at = Timestamp.fromDate(now)
    tx.update(db.doc(paths.offer(bizId, offerId)), { status: 'cancelled', cancelledAt: at, cancelledBy: uid, claimantUids: [], updatedAt: at })
    claims.docs.forEach(d => tx.update(d.ref, { status: 'superseded', decidedAt: at }))
    if (shiftSnap.exists && shiftSnap.data().openOfferId === offerId) tx.update(shiftSnap.ref, { openOfferId: null })
    audit(tx, db, bizId, uid, 'offer.cancelled', { offerId, shiftId: offer.shiftId }, now)
    return { ok: true }
  })
}

// ---- Claiming an offered shift ---------------------------------------------

// Reads everything needed to judge whether `claimant` can take the shift on
// offer, and refuses if the offer itself is no longer open to them.
async function readClaimContext(tx, db, bizId, offerId, claimantUid, now) {
  const offer = await readOffer(tx, db, bizId, offerId)
  if (!['available', 'pending'].includes(offer.status)) throw conflict('closed', 'This shift is no longer on offer.')
  if (offer.expiresAt.toDate() <= now) throw conflict('expired', 'It is too close to the shift to pick it up now.')
  if (offer.offeredByUid === claimantUid) throw invalid('This is your own shift.')
  const [shift, policies, memberSnap] = await Promise.all([
    readShift(tx, db, bizId, offer.shiftId),
    readPolicies(tx, db, bizId),
    tx.get(db.doc(paths.member(bizId, claimantUid))),
  ])
  if (shift.version !== offer.shiftVersion || shift.openOfferId !== offerId) {
    throw conflict('changed', 'This shift changed after it was offered, so the offer was closed.')
  }
  const staffId = memberSnap.data()?.staffId
  const person = staffId ? await readPerson(tx, db, bizId, staffId) : null
  if (!person) throw notFound('That person is not on this team.')
  const facts = await readFacts(tx, db, bizId, shift, person)
  return { offer, shift, policies, person, facts }
}

// Whether someone could pick up this shift, without asking. The marketplace
// shows the answer before anyone taps.
export async function previewClaim({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const offerId = requireId(input.offerId, 'offer')
  const forUid = input.claimantUid ? requireId(input.claimantUid, 'person') : uid
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    if (forUid !== uid && !isManagerRole(actor.role)) throw forbidden('Only managers can check for someone else.')
    try {
      const ctx = await readClaimContext(tx, db, bizId, offerId, forUid, now)
      return check({ ...ctx, now, audience: forUid === uid ? 'self' : 'manager' })
    } catch (err) {
      if (err instanceof TeamsError && err.status !== 404) return { ok: false, problems: [{ code: err.reason, message: err.message }] }
      throw err
    }
  })
}

export async function claimOffer({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const offerId = requireId(input.offerId, 'offer')
  const note = cleanNote(input.note)
  return db.runTransaction(async (tx) => {
    await readActor(tx, db, bizId, uid)
    const ctx = await readClaimContext(tx, db, bizId, offerId, uid, now)
    const claimRef = db.doc(paths.claim(bizId, offerId, uid))
    const existing = await tx.get(claimRef)
    // The document id is the claimant, so asking twice is the same request.
    if (existing.exists && existing.data().status === 'pending') return { status: 'pending', alreadyClaimed: true }

    const result = check({ ...ctx, now })
    if (!result.ok) throw ineligible(result.problems)

    const at = Timestamp.fromDate(now)
    const offerRef = db.doc(paths.offer(bizId, offerId))
    if (!ctx.offer.requiresApproval) {
      // First eligible person to ask gets it.
      tx.set(claimRef, { uid, name: ctx.person.name, staffId: ctx.person.staffId, note: note || null, status: 'approved', createdAt: at, decidedAt: at })
      tx.update(offerRef, { status: 'completed', completedAt: at, takenByUid: uid, takenByName: ctx.person.name, claimantUids: [], updatedAt: at })
      writeTransfer(tx, db, {
        bizId, shiftId: ctx.shift.id, shift: ctx.shift, to: ctx.person, now, actorUid: uid,
        action: 'offer.picked_up', details: { offerId },
      })
      return { status: 'approved' }
    }

    tx.set(claimRef, { uid, name: ctx.person.name, staffId: ctx.person.staffId, note: note || null, status: 'pending', createdAt: at })
    tx.update(offerRef, { status: 'pending', claimantUids: FieldValue.arrayUnion(uid), updatedAt: at })
    audit(tx, db, bizId, uid, 'claim.created', { offerId, shiftId: ctx.shift.id }, now)
    return { status: 'pending' }
  })
}

export async function withdrawClaim({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const offerId = requireId(input.offerId, 'offer')
  return db.runTransaction(async (tx) => {
    const claimRef = db.doc(paths.claim(bizId, offerId, uid))
    const [claimSnap, offer, pending] = await Promise.all([
      tx.get(claimRef), readOffer(tx, db, bizId, offerId), readPendingClaims(tx, db, bizId, offerId),
    ])
    if (!claimSnap.exists || claimSnap.data().status !== 'pending') return { ok: true }
    const at = Timestamp.fromDate(now)
    tx.update(claimRef, { status: 'withdrawn', decidedAt: at })
    const othersWaiting = pending.docs.some(d => d.id !== uid)
    tx.update(db.doc(paths.offer(bizId, offerId)), {
      claimantUids: FieldValue.arrayRemove(uid),
      ...(offer.status === 'pending' && !othersWaiting ? { status: 'available' } : {}),
      updatedAt: at,
    })
    audit(tx, db, bizId, uid, 'claim.withdrawn', { offerId }, now)
    return { ok: true }
  })
}

export async function decideClaim({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const offerId = requireId(input.offerId, 'offer')
  const claimantUid = requireId(input.claimantUid, 'person')
  const approve = input.approve === true
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const claimRef = db.doc(paths.claim(bizId, offerId, claimantUid))
    const [claimSnap, pending] = await Promise.all([tx.get(claimRef), readPendingClaims(tx, db, bizId, offerId)])
    if (!claimSnap.exists || claimSnap.data().status !== 'pending') throw conflict('closed', 'This request has already been decided or withdrawn.')
    const at = Timestamp.fromDate(now)
    const offerRef = db.doc(paths.offer(bizId, offerId))

    if (!approve) {
      const offer = await readOffer(tx, db, bizId, offerId)
      const othersWaiting = pending.docs.some(d => d.id !== claimantUid)
      tx.update(claimRef, { status: 'rejected', decidedAt: at, decidedBy: uid, managerNote: cleanNote(input.note) || null })
      tx.update(offerRef, {
        claimantUids: FieldValue.arrayRemove(claimantUid),
        ...(offer.status === 'pending' && !othersWaiting ? { status: 'available' } : {}),
        updatedAt: at,
      })
      audit(tx, db, bizId, uid, 'claim.rejected', { offerId, claimantUid }, now)
      return { status: 'rejected' }
    }

    // Judged again now: the claimant's week may have filled up since they asked.
    const ctx = await readClaimContext(tx, db, bizId, offerId, claimantUid, now)
    const result = check({ ...ctx, now, audience: 'manager' })
    if (!result.ok) throw ineligible(result.problems)

    tx.update(claimRef, { status: 'approved', decidedAt: at, decidedBy: uid })
    pending.docs.filter(d => d.id !== claimantUid).forEach(d => tx.update(d.ref, { status: 'superseded', decidedAt: at }))
    tx.update(offerRef, {
      status: 'completed', completedAt: at, approvedBy: uid, takenByUid: claimantUid, takenByName: ctx.person.name,
      claimantUids: [], updatedAt: at,
    })
    writeTransfer(tx, db, {
      bizId, shiftId: ctx.shift.id, shift: ctx.shift, to: ctx.person, now, actorUid: uid,
      action: 'offer.approved', details: { offerId },
    })
    return { status: 'approved' }
  })
}

// ---- Swaps ------------------------------------------------------------------

// Coworkers' upcoming shifts that could be swapped for one of yours. Each
// comes with whether you could work it, judged against your own schedule; the
// full check, both ways, runs when you ask.
export async function listSwapCandidates({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const myShiftId = requireId(input.myShiftId, 'shift')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const [mine, policies] = await Promise.all([readShift(tx, db, bizId, myShiftId), readPolicies(tx, db, bizId)])
    if (mine.assigneeUid !== uid) throw forbidden('You can only swap your own shifts.')
    requireTradable(mine, policies, now, 'Your shift')
    const from = Timestamp.fromMillis(now.getTime() + (policies.offerCutoffHours || 0) * HOUR)
    const to = Timestamp.fromMillis(now.getTime() + SWAP_HORIZON_DAYS * 24 * HOUR)
    const [upcoming, myUpcoming] = await Promise.all([
      tx.get(db.collection(`businesses/${bizId}/shifts`)
        .where('published', '==', true).where('startAt', '>=', from).where('startAt', '<', to).orderBy('startAt').limit(200)),
      tx.get(db.collection(`businesses/${bizId}/shifts`)
        .where('staffId', '==', actor.staffId).where('startAt', '>=', Timestamp.fromMillis(from.toMillis() - 2 * 24 * HOUR)).where('startAt', '<', to)),
    ])
    const myShifts = myUpcoming.docs.map(d => toPlainShift(d.id, d.data()))
    const person = { name: actor.displayName, uid, staffId: actor.staffId, active: true }
    return {
      candidates: upcoming.docs
        .map(d => toPlainShift(d.id, d.data()))
        .filter(s => s.status !== 'cancelled' && s.assigneeUid && s.assigneeUid !== uid && !s.openOfferId && !s.swapId)
        .map(s => {
          const r = checkAssignment({ shift: s, person, sameBusinessShifts: myShifts, policies, now, excludeShiftIds: [myShiftId] })
          return {
            shiftId: s.id, date: s.date, startLocal: s.startLocal, endLocal: s.endLocal, overnight: Boolean(s.overnight),
            minutes: s.minutes, positionName: s.positionName || null, staffName: s.staffName,
            ok: r.ok, reason: r.problems[0]?.message || null,
          }
        }),
    }
  })
}

async function readSwapSide(tx, db, bizId, shift) {
  const person = await readPerson(tx, db, bizId, shift.staffId)
  if (!person) throw notFound('Someone in this swap is no longer on the team.')
  const facts = await readFacts(tx, db, bizId, shift, person)
  return { person, facts }
}

// Both directions: A works B's shift without A's own, and B works A's
// without B's own.
function checkSwap({ shiftA, shiftB, sideA, sideB, policies, now, audience }) {
  const aTakesB = check({ shift: shiftB, person: sideA.person, facts: sideA.facts, policies, now, audience, excludeShiftIds: [shiftA.id] })
  const bTakesA = check({ shift: shiftA, person: sideB.person, facts: sideB.facts, policies, now, audience: 'manager', excludeShiftIds: [shiftB.id] })
  return { ok: aTakesB.ok && bTakesA.ok, problems: [...aTakesB.problems, ...bTakesA.problems] }
}

export async function requestSwap({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const myShiftId = requireId(input.myShiftId, 'shift')
  const theirShiftId = requireId(input.theirShiftId, 'shift')
  if (myShiftId === theirShiftId) throw invalid('Choose someone else’s shift.')
  const note = cleanNote(input.note)
  return db.runTransaction(async (tx) => {
    await readActor(tx, db, bizId, uid)
    const [shiftA, shiftB, policies] = await Promise.all([
      readShift(tx, db, bizId, myShiftId), readShift(tx, db, bizId, theirShiftId), readPolicies(tx, db, bizId),
    ])
    if (shiftA.assigneeUid !== uid) throw forbidden('You can only swap your own shifts.')
    if (!shiftB.assigneeUid || shiftB.assigneeUid === uid) throw invalid('Choose a coworker’s shift.')
    requireTradable(shiftA, policies, now, 'Your shift')
    requireTradable(shiftB, policies, now, 'Their shift')
    if (shiftA.openOfferId || shiftA.swapId) throw conflict('locked', 'Your shift is already on offer or in another swap.')
    if (shiftB.openOfferId || shiftB.swapId) throw conflict('locked', 'That shift is already on offer or in another swap.')

    const [sideA, sideB] = await Promise.all([readSwapSide(tx, db, bizId, shiftA), readSwapSide(tx, db, bizId, shiftB)])
    if (!sideB.person.active) throw conflict('not_member', `${sideB.person.name} is no longer on the team.`)
    const result = checkSwap({ shiftA, shiftB, sideA, sideB, policies, now, audience: 'self' })
    if (!result.ok) throw ineligible(result.problems)

    const ref = db.collection(`businesses/${bizId}/swaps`).doc()
    const at = Timestamp.fromDate(now)
    tx.set(ref, {
      requesterUid: uid, requesterName: sideA.person.name,
      counterpartyUid: shiftB.assigneeUid, counterpartyName: sideB.person.name,
      shiftA: snapshotOf(shiftA), shiftB: snapshotOf(shiftB),
      versionA: shiftA.version, versionB: shiftB.version,
      note: note || null, status: 'pending_peer', requiresApproval: Boolean(policies.swapRequiresApproval),
      expiresAt: Timestamp.fromMillis(Math.min(new Date(shiftA.startAt), new Date(shiftB.startAt)) - (policies.offerCutoffHours || 0) * HOUR),
      createdAt: at, updatedAt: at,
    })
    tx.update(db.doc(paths.shift(bizId, myShiftId)), { swapId: ref.id })
    tx.update(db.doc(paths.shift(bizId, theirShiftId)), { swapId: ref.id })
    audit(tx, db, bizId, uid, 'swap.requested', { swapId: ref.id, shiftA: myShiftId, shiftB: theirShiftId }, now)
    return { swapId: ref.id }
  })
}

// Reads a swap and both its shifts, and refuses if either shift moved on.
async function readSwapContext(tx, db, bizId, swapId) {
  const swapSnap = await tx.get(db.doc(paths.swap(bizId, swapId)))
  if (!swapSnap.exists) throw notFound('That swap request no longer exists.')
  const swap = swapSnap.data()
  const [shiftA, shiftB, policies] = await Promise.all([
    readShift(tx, db, bizId, swap.shiftA.id), readShift(tx, db, bizId, swap.shiftB.id), readPolicies(tx, db, bizId),
  ])
  const stale = shiftA.version !== swap.versionA || shiftB.version !== swap.versionB
    || shiftA.swapId !== swapId || shiftB.swapId !== swapId
  return { swap, shiftA, shiftB, policies, stale }
}

function writeSwapClosed(tx, db, bizId, swapId, ctx, status, extra, now) {
  const at = Timestamp.fromDate(now)
  tx.update(db.doc(paths.swap(bizId, swapId)), { status, updatedAt: at, decidedAt: at, ...extra })
  if (ctx.shiftA.swapId === swapId) tx.update(db.doc(paths.shift(bizId, ctx.shiftA.id)), { swapId: null })
  if (ctx.shiftB.swapId === swapId) tx.update(db.doc(paths.shift(bizId, ctx.shiftB.id)), { swapId: null })
}

// Both sides move in one transaction, or neither does.
function writeSwapDone(tx, db, bizId, swapId, ctx, sideA, sideB, actorUid, now) {
  const at = Timestamp.fromDate(now)
  tx.update(db.doc(paths.swap(bizId, swapId)), { status: 'completed', completedAt: at, decidedAt: at, decidedBy: actorUid, updatedAt: at })
  writeTransfer(tx, db, { bizId, shiftId: ctx.shiftA.id, shift: ctx.shiftA, to: sideB.person, now, actorUid, action: 'swap.completed', details: { swapId, side: 'A' } })
  writeTransfer(tx, db, { bizId, shiftId: ctx.shiftB.id, shift: ctx.shiftB, to: sideA.person, now, actorUid, action: 'swap.completed', details: { swapId, side: 'B' } })
}

function refuseIfClosed(ctx, statuses, now) {
  if (!statuses.includes(ctx.swap.status)) throw conflict('closed', 'This swap request has already been decided or cancelled.')
  if (ctx.swap.expiresAt.toDate() <= now) throw conflict('expired', 'It is too close to the shifts to swap them now.')
}

export async function respondSwap({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const swapId = requireId(input.swapId, 'swap')
  const accept = input.accept === true
  return db.runTransaction(async (tx) => {
    const ctx = await readSwapContext(tx, db, bizId, swapId)
    if (ctx.swap.counterpartyUid !== uid) throw forbidden('This swap request is not addressed to you.')
    refuseIfClosed(ctx, ['pending_peer'], now)
    if (!accept) {
      writeSwapClosed(tx, db, bizId, swapId, ctx, 'declined', {}, now)
      audit(tx, db, bizId, uid, 'swap.declined', { swapId }, now)
      return { status: 'declined' }
    }
    // Closing it is the outcome, not an error: a throw would roll the close back.
    if (ctx.stale) {
      writeSwapClosed(tx, db, bizId, swapId, ctx, 'cancelled', { cancelReason: 'shift_changed' }, now)
      return { status: 'cancelled', message: 'One of these shifts changed after the swap was asked for, so the request was closed.' }
    }
    const [sideA, sideB] = await Promise.all([readSwapSide(tx, db, bizId, ctx.shiftA), readSwapSide(tx, db, bizId, ctx.shiftB)])
    // From the accepting side's point of view: they are B, taking A's shift.
    const result = checkSwap({ shiftA: ctx.shiftB, shiftB: ctx.shiftA, sideA: sideB, sideB: sideA, policies: ctx.policies, now, audience: 'self' })
    if (!result.ok) throw ineligible(result.problems)

    if (ctx.swap.requiresApproval) {
      tx.update(db.doc(paths.swap(bizId, swapId)), { status: 'pending_manager', acceptedAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) })
      audit(tx, db, bizId, uid, 'swap.accepted', { swapId }, now)
      return { status: 'pending_manager' }
    }
    writeSwapDone(tx, db, bizId, swapId, ctx, sideA, sideB, uid, now)
    return { status: 'completed' }
  })
}

export async function decideSwap({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const swapId = requireId(input.swapId, 'swap')
  const approve = input.approve === true
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ctx = await readSwapContext(tx, db, bizId, swapId)
    refuseIfClosed(ctx, ['pending_manager'], now)
    if (!approve) {
      writeSwapClosed(tx, db, bizId, swapId, ctx, 'rejected', { decidedBy: uid, managerNote: cleanNote(input.note) || null }, now)
      audit(tx, db, bizId, uid, 'swap.rejected', { swapId }, now)
      return { status: 'rejected' }
    }
    if (ctx.stale) throw conflict('changed', 'One of these shifts changed after the swap was agreed. Reject it and ask them to request again.')
    const [sideA, sideB] = await Promise.all([readSwapSide(tx, db, bizId, ctx.shiftA), readSwapSide(tx, db, bizId, ctx.shiftB)])
    const result = checkSwap({ shiftA: ctx.shiftA, shiftB: ctx.shiftB, sideA, sideB, policies: ctx.policies, now, audience: 'manager' })
    if (!result.ok) throw ineligible(result.problems)
    writeSwapDone(tx, db, bizId, swapId, ctx, sideA, sideB, uid, now)
    return { status: 'completed' }
  })
}

export async function cancelSwap({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const swapId = requireId(input.swapId, 'swap')
  return db.runTransaction(async (tx) => {
    const ctx = await readSwapContext(tx, db, bizId, swapId)
    if (ctx.swap.requesterUid !== uid) throw forbidden('Only the person who asked can cancel this swap.')
    if (!['pending_peer', 'pending_manager'].includes(ctx.swap.status)) return { ok: true }
    writeSwapClosed(tx, db, bizId, swapId, ctx, 'cancelled', { cancelledBy: uid }, now)
    audit(tx, db, bizId, uid, 'swap.cancelled', { swapId }, now)
    return { ok: true }
  })
}
