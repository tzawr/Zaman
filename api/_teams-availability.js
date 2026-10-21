import { randomBytes } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { DEFAULT_POLICIES, TIME_OFF_CATEGORIES, canTransition, paths } from '../shared/teams/schema.js'
import {
  MAX_OVERRIDES, timeOffClash, validateOverride, validateTimeOff, validateWeekly, withVersion,
} from '../shared/teams/availability.js'
import { addDays, isDateString, parseTime, todayIn, zonedToUtc } from '../shared/teams/time.js'
import { cleanName, isManagerRole } from '../shared/teams/workspace.js'
import { conflict, forbidden, invalid, notFound } from './_teams-http.js'
import { audit, readActor, readManager, requireId, requireString, sha256 } from './_teams-common.js'
import { readPolicies } from './_teams-assignments.js'

// Availability, time off and the business's policies. Employees submit their
// own availability and time off; managers can see everyone's, edit anyone's
// availability, and decide time off. Each change is one transaction with an
// audit entry, like every other Teams workflow.

const MAX_EFFECTIVE_DAYS_AHEAD = 180
const NOTE_MAX = 280

async function readBusiness(tx, db, bizId) {
  const snap = await tx.get(db.doc(paths.business(bizId)))
  if (!snap.exists) throw notFound('That workspace does not exist.')
  return snap.data()
}

// Whose availability a call is about: the caller's own, or, for a manager,
// anyone on the roster.
async function readSubject(tx, db, bizId, actor, staffIdInput) {
  const staffId = staffIdInput ? requireId(staffIdInput, 'person') : actor.staffId
  if (!staffId) throw notFound('You are not on this workplace’s roster.')
  if (staffId !== actor.staffId && !isManagerRole(actor.role)) throw forbidden('Only managers can change someone else’s availability.')
  const staffSnap = await tx.get(db.doc(paths.staff(bizId, staffId)))
  if (!staffSnap.exists) throw notFound('That person is not on your team.')
  return { staffId, staff: staffSnap.data(), self: staffId === actor.staffId }
}

function requireCanSubmit(actor, policies, self) {
  if (self && !isManagerRole(actor.role) && policies.employeesCanSubmitAvailability === false) {
    throw forbidden('Your manager sets availability for this workplace. Ask them to update it.')
  }
}

export async function saveAvailability({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const weekly = validateWeekly(input.weekly)
  if (!weekly.ok) throw invalid(weekly.message)
  const preferred = input.preferredHoursPerWeek === null || input.preferredHoursPerWeek === undefined || input.preferredHoursPerWeek === ''
    ? null : Number(input.preferredHoursPerWeek)
  if (preferred !== null && !(Number.isFinite(preferred) && preferred >= 0 && preferred <= 100)) {
    throw invalid('Preferred hours should be a number between 0 and 100.')
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, NOTE_MAX) : ''

  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const [business, policies] = await Promise.all([readBusiness(tx, db, bizId), readPolicies(tx, db, bizId)])
    const subject = await readSubject(tx, db, bizId, actor, input.staffId)
    requireCanSubmit(actor, policies, subject.self)

    const today = todayIn(business.timezone, now)
    const effectiveFrom = input.effectiveFrom || today
    if (!isDateString(effectiveFrom) || effectiveFrom < today) throw invalid('Changes can start today or later.')
    if (effectiveFrom > addDays(today, MAX_EFFECTIVE_DAYS_AHEAD)) throw invalid('Choose a start date within the next six months.')

    const ref = db.doc(paths.availability(bizId, subject.staffId))
    const snap = await tx.get(ref)
    const existing = snap.exists ? snap.data() : {}
    const at = Timestamp.fromDate(now)
    const version = {
      effectiveFrom, weekly: weekly.value, preferredHoursPerWeek: preferred, note: note || null,
      savedAt: at, savedBy: uid,
    }
    tx.set(ref, {
      uid: subject.staff.uid || null,
      staffId: subject.staffId,
      staffName: subject.staff.name,
      versions: withVersion(existing.versions, version, today),
      overrides: (existing.overrides || []).filter(o => o.to >= today),
      updatedAt: at,
      updatedBy: uid,
      updatedByRole: subject.self ? 'self' : 'manager',
      version: (existing.version || 0) + 1,
    })
    audit(tx, db, bizId, uid, 'availability.saved', { staffId: subject.staffId, effectiveFrom }, now)
    return { ok: true, effectiveFrom }
  })
}

export async function addAvailabilityOverride({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const [business, policies] = await Promise.all([readBusiness(tx, db, bizId), readPolicies(tx, db, bizId)])
    const subject = await readSubject(tx, db, bizId, actor, input.staffId)
    requireCanSubmit(actor, policies, subject.self)
    const today = todayIn(business.timezone, now)
    const override = validateOverride(input, today)
    if (!override.ok) throw invalid(override.message)

    const ref = db.doc(paths.availability(bizId, subject.staffId))
    const snap = await tx.get(ref)
    const existing = snap.exists ? snap.data() : {}
    const kept = (existing.overrides || []).filter(o => o.to >= today)
    if (kept.some(o => o.from <= override.value.to && o.to >= override.value.from)) {
      throw conflict('overlap', 'You already have a temporary change on some of those dates. Remove it first.')
    }
    if (kept.length >= MAX_OVERRIDES) throw invalid(`You can have at most ${MAX_OVERRIDES} temporary changes at once.`)
    const at = Timestamp.fromDate(now)
    const id = randomBytes(8).toString('hex')
    tx.set(ref, {
      uid: subject.staff.uid || null,
      staffId: subject.staffId,
      staffName: subject.staff.name,
      versions: existing.versions || [],
      overrides: [...kept, { id, ...override.value, createdAt: at, createdBy: uid }]
        .sort((a, b) => a.from.localeCompare(b.from)),
      updatedAt: at,
      updatedBy: uid,
      updatedByRole: subject.self ? 'self' : 'manager',
      version: (existing.version || 0) + 1,
    })
    audit(tx, db, bizId, uid, 'availability.override_added', { staffId: subject.staffId, from: override.value.from, to: override.value.to }, now)
    return { ok: true, overrideId: id }
  })
}

export async function removeAvailabilityOverride({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const overrideId = requireString(input.overrideId, 'Missing change.')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const policies = await readPolicies(tx, db, bizId)
    const subject = await readSubject(tx, db, bizId, actor, input.staffId)
    requireCanSubmit(actor, policies, subject.self)
    const ref = db.doc(paths.availability(bizId, subject.staffId))
    const snap = await tx.get(ref)
    if (!snap.exists) return { ok: true }
    const overrides = snap.data().overrides || []
    if (!overrides.some(o => o.id === overrideId)) return { ok: true }
    const at = Timestamp.fromDate(now)
    tx.update(ref, {
      overrides: overrides.filter(o => o.id !== overrideId),
      updatedAt: at, updatedBy: uid, version: (snap.data().version || 0) + 1,
    })
    audit(tx, db, bizId, uid, 'availability.override_removed', { staffId: subject.staffId, overrideId }, now)
    return { ok: true }
  })
}

// ---- Time off ---------------------------------------------------------------

function allowedCategories(policies) {
  return [...new Set([...(policies.timeOffCategories || TIME_OFF_CATEGORIES)])]
}

export async function requestTimeOff({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  // One id per attempt from the app, so a retried request is the same request.
  const requestId = requireString(input.requestId, 'Missing request id.')
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw invalid('Invalid request id.')
  const ref = db.doc(paths.timeOff(bizId, sha256(`${uid}:${requestId}`).slice(0, 20)))

  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const existing = await tx.get(ref)
    if (existing.exists) return { id: ref.id, status: existing.data().status, duplicate: true }
    const [business, policies] = await Promise.all([readBusiness(tx, db, bizId), readPolicies(tx, db, bizId)])
    if (!actor.staffId) throw notFound('You are not on this workplace’s roster.')
    const today = todayIn(business.timezone, now)
    const checked = validateTimeOff(input, { today, categories: allowedCategories(policies) })
    if (!checked.ok) throw invalid(checked.message)
    const r = checked.value

    const mine = await tx.get(db.collection(`businesses/${bizId}/timeOff`).where('staffId', '==', actor.staffId))
    const clash = mine.docs.map(d => d.data()).find(o =>
      ['pending', 'approved'].includes(o.status) && o.startDate <= r.endDate && o.endDate >= r.startDate)
    if (clash) throw conflict('overlap', 'You already have a time off request covering some of those days.')

    // The instants it covers, in the business's time zone, for anything that
    // needs to compare it with shifts or with Hengam.
    const startAt = zonedToUtc(r.startDate, r.partial ? parseTime(r.partial.start) : 0, business.timezone)
    let endAt
    if (r.partial) {
      const s = parseTime(r.partial.start)
      const e = parseTime(r.partial.end)
      endAt = zonedToUtc(e > s ? r.startDate : addDays(r.startDate, 1), e, business.timezone)
    } else {
      endAt = zonedToUtc(addDays(r.endDate, 1), 0, business.timezone)
    }
    const at = Timestamp.fromDate(now)
    const staffSnap = await tx.get(db.doc(paths.staff(bizId, actor.staffId)))
    tx.set(ref, {
      uid, staffId: actor.staffId, staffName: staffSnap.data()?.name || actor.displayName,
      ...r, reason: r.reason || null,
      startAt: Timestamp.fromDate(startAt), endAt: Timestamp.fromDate(endAt),
      status: 'pending', createdAt: at, updatedAt: at,
    })
    audit(tx, db, bizId, uid, 'time_off.requested', { timeOffId: ref.id, startDate: r.startDate, endDate: r.endDate, category: r.category }, now)
    return {
      id: ref.id,
      status: 'pending',
      notify: [{ kind: 'timeOffRequested', bizId, to: 'managers', exclude: [uid],
        params: { request: { id: ref.id, staffName: staffSnap.data()?.name || actor.displayName, ...r } } }],
    }
  })
}

export async function cancelTimeOff({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const id = requireId(input.timeOffId, 'request')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const ref = db.doc(paths.timeOff(bizId, id))
    const [snap, business] = await Promise.all([tx.get(ref), readBusiness(tx, db, bizId)])
    if (!snap.exists) throw notFound('That request no longer exists.')
    const r = snap.data()
    if (r.uid !== uid && !isManagerRole(actor.role)) throw forbidden('You can only cancel your own requests.')
    if (r.status === 'cancelled') return { ok: true }
    if (!canTransition('timeOff', r.status, 'cancelled')) throw conflict('closed', 'This request has already been decided.')
    if (r.status === 'approved' && r.startDate <= todayIn(business.timezone, now)) {
      throw conflict('started', 'This time off has already started. Ask your manager to change it.')
    }
    const at = Timestamp.fromDate(now)
    tx.update(ref, { status: 'cancelled', cancelledAt: at, cancelledBy: uid, updatedAt: at })
    audit(tx, db, bizId, uid, 'time_off.cancelled', { timeOffId: id }, now)
    return { ok: true }
  })
}

export async function decideTimeOff({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const id = requireId(input.timeOffId, 'request')
  const approve = input.approve === true
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, NOTE_MAX) : ''
  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = db.doc(paths.timeOff(bizId, id))
    const snap = await tx.get(ref)
    if (!snap.exists) throw notFound('That request no longer exists.')
    const r = snap.data()
    const next = approve ? 'approved' : 'rejected'
    if (!canTransition('timeOff', r.status, next)) throw conflict('closed', 'This request has already been decided or cancelled.')

    // Shifts the person already has in that time. Approving does not remove
    // them; the manager is told so they can reassign them.
    const shiftsSnap = await tx.get(db.collection(`businesses/${bizId}/shifts`)
      .where('staffId', '==', r.staffId).where('startAt', '>=', Timestamp.fromDate(new Date(`${addDays(r.startDate, -1)}T00:00:00Z`)))
      .where('startAt', '<', Timestamp.fromDate(new Date(`${addDays(r.endDate, 2)}T00:00:00Z`))))
    const clashing = shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.status !== 'cancelled' && timeOffClash(s, r))

    const at = Timestamp.fromDate(now)
    tx.update(ref, { status: next, decidedAt: at, decidedBy: uid, managerNote: note || null, updatedAt: at })
    audit(tx, db, bizId, uid, approve ? 'time_off.approved' : 'time_off.rejected', { timeOffId: id }, now)
    return {
      status: next,
      notify: [{ kind: 'timeOffDecided', bizId, to: r.uid,
        params: { request: { id, ...r, managerNote: note || null }, approved: approve } }],
      clashingShifts: approve ? clashing.map(s => ({ id: s.id, date: s.date, startLocal: s.startLocal, endLocal: s.endLocal, overnight: Boolean(s.overnight) })) : [],
    }
  })
}

// ---- Policies ---------------------------------------------------------------

const BOOLEAN_POLICIES = ['pickupRequiresApproval', 'swapRequiresApproval', 'employeeFullView', 'employeesCanSubmitAvailability', 'requirePositionMatch', 'requireLocationMatch']
const NUMBER_POLICIES = {
  maxHoursPerWeek: [1, 100], maxHoursPerDay: [1, 24], minRestHours: [1, 24], offerCutoffHours: [0, 72],
}
const NUMBER_LABELS = {
  maxHoursPerWeek: 'Weekly hour limit', maxHoursPerDay: 'Daily hour limit',
  minRestHours: 'Minimum rest', offerCutoffHours: 'Trading cut-off',
}
const MAX_CUSTOM_CATEGORIES = 10

export async function updatePolicies({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const changes = {}
  for (const key of BOOLEAN_POLICIES) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw invalid(`Invalid value for ${key}.`)
      changes[key] = input[key]
    }
  }
  for (const [key, [min, max]] of Object.entries(NUMBER_POLICIES)) {
    if (!(key in input)) continue
    if (input[key] === null || input[key] === '') {
      // The trading cut-off always has a value; the limits can be switched off.
      changes[key] = key === 'offerCutoffHours' ? 0 : null
      continue
    }
    const n = Number(input[key])
    if (!Number.isFinite(n) || n < min || n > max) throw invalid(`${NUMBER_LABELS[key]} should be between ${min} and ${max} hours.`)
    changes[key] = n
  }
  if ('customTimeOffCategories' in input) {
    if (!Array.isArray(input.customTimeOffCategories) || input.customTimeOffCategories.length > MAX_CUSTOM_CATEGORIES) {
      throw invalid(`Add at most ${MAX_CUSTOM_CATEGORIES} time off categories of your own.`)
    }
    const custom = input.customTimeOffCategories.map(c => {
      const label = cleanName(c?.label, 30)
      if (!label) throw invalid('Give each time off category a name.')
      return { id: `custom-${sha256(label.toLowerCase()).slice(0, 8)}`, label }
    })
    if (new Set(custom.map(c => c.id)).size !== custom.length) throw invalid('Two of your categories have the same name.')
    changes.customTimeOffCategories = custom
    const builtIns = Array.isArray(input.builtInTimeOffCategories)
      ? input.builtInTimeOffCategories.filter(id => TIME_OFF_CATEGORIES.includes(id))
      : TIME_OFF_CATEGORIES
    changes.timeOffCategories = [...builtIns, ...custom.map(c => c.id)]
    if (!changes.timeOffCategories.length) throw invalid('Keep at least one kind of time off.')
  }
  if (!Object.keys(changes).length) throw invalid('Nothing to change.')

  return db.runTransaction(async (tx) => {
    await readManager(tx, db, bizId, uid)
    const ref = db.doc(paths.policies(bizId))
    const snap = await tx.get(ref)
    const before = { ...DEFAULT_POLICIES, ...(snap.exists ? snap.data() : {}) }
    tx.set(ref, { ...changes, updatedAt: Timestamp.fromDate(now), updatedBy: uid }, { merge: true })
    audit(tx, db, bizId, uid, 'policies.updated', {
      before: Object.fromEntries(Object.keys(changes).map(k => [k, before[k] ?? null])),
      after: changes,
    }, now)
    return { ok: true }
  })
}
