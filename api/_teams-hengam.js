import { Timestamp } from 'firebase-admin/firestore'
import { DEFAULT_POLICIES, paths } from '../shared/teams/schema.js'
import { desiredShiftsFromHengam, hengamBusinessId, publishFingerprint, shiftDiffers } from '../shared/teams/hengam.js'
import { isDateString, resolveShiftTimes, weekStartOf } from '../shared/teams/time.js'
import { isValidTimezone } from '../shared/teams/workspace.js'
import { TeamsError, conflict, forbidden, invalid, notFound } from './_teams-http.js'
import { audit, requireId, requireString } from './_teams-common.js'
import { clearBusyBlock, readLocks, writeBusyBlock, writeReleaseLocks } from './_teams-assignments.js'

// Hengam and Teams share one Firestore, so syncing is not messaging between
// systems: each step below is one transaction that reads both sides and
// writes both sides, or neither. Nothing is queued, so nothing can be half
// applied or replayed out of order, and there is no loop to break: Teams
// never triggers a Hengam publish, and a publish never writes back to itself.

// A business can hold this many shifts in one published week. Each shift
// costs up to two writes (itself and a busy-index entry) and Firestore caps a
// transaction at 500.
const MAX_SHIFTS_PER_PUBLISH = 200

async function readHengamManager(tx, db, uid) {
  const snap = await tx.get(db.doc(`users/${uid}`))
  const user = snap.exists ? snap.data() : null
  if (!user || user.accountType === 'employee') {
    throw forbidden('Only a Hengam workspace owner can connect Hengam Teams.')
  }
  return user
}

// The Hengam roster as Teams staff: one staff document per Hengam employee,
// with the employee's id as the staff id. Returns what to write; the caller
// writes it once all its reads are done.
function rosterWrites(employees, staffSnap, now) {
  const existing = new Map(staffSnap.docs.map(d => [d.id, d.data()]))
  const at = Timestamp.fromDate(now)
  const writes = []
  for (const e of employees) {
    const current = existing.get(e.id)
    const positionNames = e.role ? [String(e.role).slice(0, 40)] : []
    const changed = !current || current.name !== e.name || current.archived
      || JSON.stringify(current.positionNames || []) !== JSON.stringify(positionNames)
    if (changed) {
      writes.push({ id: e.id, data: { name: e.name, positionNames, hengamEmployeeId: e.id, archived: false, updatedAt: at, ...(current ? {} : { locationIds: [], createdAt: at }) } })
    }
  }
  // Someone removed from Hengam stays on the roster, so past shifts keep a
  // name, but is marked as gone.
  const live = new Set(employees.map(e => e.id))
  for (const [id, s] of existing) {
    if (s.hengamEmployeeId && !live.has(id) && !s.archived) writes.push({ id, data: { archived: true, updatedAt: at } })
  }
  return writes
}

export async function hengamConnect({ db, uid, token, input, now }) {
  if (token?.email_verified !== true) throw forbidden('Verify your email address first.')
  const timezone = requireString(input.timezone, 'Choose a time zone.')
  if (!isValidTimezone(timezone)) throw invalid('Choose a valid time zone.')
  const bizId = hengamBusinessId(uid)

  return db.runTransaction(async (tx) => {
    const manager = await readHengamManager(tx, db, uid)
    const bizRef = db.doc(paths.business(bizId))
    const [bizSnap, employeesSnap, portalSnap, staffSnap] = await Promise.all([
      tx.get(bizRef),
      tx.get(db.collection('employees').where('userId', '==', uid)),
      tx.get(db.collection('users').where('managerId', '==', uid).where('accountType', '==', 'employee')),
      tx.get(db.collection(`businesses/${bizId}/staff`)),
    ])
    if (bizSnap.exists) return { bizId, created: false }

    const at = Timestamp.fromDate(now)
    const name = String(manager.businessName || '').trim().slice(0, 80) || 'My workplace'
    const employees = employeesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const ownerStaffId = `owner-${uid}`

    tx.set(bizRef, { name, mode: 'hengam', hengamOwnerUid: uid, timezone, createdBy: uid, createdAt: at })
    tx.set(db.doc(paths.policies(bizId)), { ...DEFAULT_POLICIES, updatedAt: at })
    tx.set(db.doc(paths.member(bizId, uid)), { role: 'owner', status: 'active', staffId: ownerStaffId, displayName: manager.displayName || 'Manager', joinedAt: at })
    tx.set(db.doc(paths.staff(bizId, ownerStaffId)), { name: manager.displayName || 'Manager', uid, positionNames: [], locationIds: [], createdAt: at })
    tx.set(db.doc(paths.workplace(uid, bizId)), { name, role: 'owner', joinedAt: at })
    for (const w of rosterWrites(employees, staffSnap, now)) tx.set(db.doc(paths.staff(bizId, w.id)), w.data, { merge: true })

    // People who already use Hengam's employee portal are members from the
    // start, each linked to their own employee record.
    const live = new Set(employees.map(e => e.id))
    let linked = 0
    for (const p of portalSnap.docs) {
      const employeeId = p.data().linkedEmployeeId
      if (!employeeId || !live.has(employeeId)) continue
      const staffName = employees.find(e => e.id === employeeId).name
      tx.set(db.doc(paths.staff(bizId, employeeId)), { uid: p.id }, { merge: true })
      tx.set(db.doc(paths.member(bizId, p.id)), { role: 'employee', status: 'active', staffId: employeeId, displayName: staffName, joinedAt: at })
      tx.set(db.doc(paths.workplace(p.id, bizId)), { name, role: 'employee', joinedAt: at })
      linked++
    }
    tx.set(db.doc(`users/${uid}`), { teamsBizId: bizId }, { merge: true })
    audit(tx, db, bizId, uid, 'hengam.connected', { employees: employees.length, linked }, now)
    return { bizId, created: true, employees: employees.length, linked }
  })
}

export async function hengamPublish({ db, uid, input, now }) {
  const scheduleId = requireId(input.scheduleId, 'schedule')
  const bizId = hengamBusinessId(uid)

  return db.runTransaction(async (tx) => {
    const hengamRef = db.doc(`schedules/${scheduleId}`)
    const [hengamSnap, bizSnap] = await Promise.all([tx.get(hengamRef), tx.get(db.doc(paths.business(bizId)))])
    if (!hengamSnap.exists || hengamSnap.data().userId !== uid) throw notFound('That schedule does not exist.')
    if (!bizSnap.exists) throw conflict('not_connected', 'Connect Hengam Teams in Settings first.')
    const hengam = hengamSnap.data()
    const business = bizSnap.data()
    const weekStart = hengam.weekStart
    if (!isDateString(weekStart) || weekStartOf(weekStart) !== weekStart) throw invalid('This schedule has no valid week.')

    const [employeesSnap, staffSnap, teamsScheduleSnap, existingSnap] = await Promise.all([
      tx.get(db.collection('employees').where('userId', '==', uid)),
      tx.get(db.collection(`businesses/${bizId}/staff`)),
      tx.get(db.doc(paths.schedule(bizId, weekStart))),
      tx.get(db.collection(`businesses/${bizId}/shifts`).where('scheduleId', '==', weekStart)),
    ])
    const employees = employeesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const { errors, shifts: desired } = desiredShiftsFromHengam({ scheduleId, weekStart, data: hengam.data, employees })
    if (errors.length) throw new TeamsError(422, 'unmatched', errors.join(' '), errors.map(message => ({ code: 'unmatched', message })))
    if (desired.length > MAX_SHIFTS_PER_PUBLISH) throw invalid(`A week can have at most ${MAX_SHIFTS_PER_PUBLISH} shifts in Hengam Teams.`)

    const fingerprint = publishFingerprint(desired)
    const teamsSchedule = teamsScheduleSnap.exists ? teamsScheduleSnap.data() : null
    if (teamsSchedule?.sourceHash === fingerprint && teamsSchedule.sourceRef === scheduleId) {
      return { unchanged: true, weekStart, created: 0, updated: 0, cancelled: 0 }
    }

    // Who each shift is for: staff accounts after this publish's roster sync.
    const uidByStaff = new Map(staffSnap.docs.map(d => [d.id, d.data().uid || null]))
    const existing = new Map(existingSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]))
    const plan = []
    for (const d of desired) {
      const r = resolveShiftTimes({ date: d.date, start: d.start, end: d.end, timezone: business.timezone })
      if (!r.ok) throw invalid(`${d.staffName} on ${d.date}: ${r.message}`)
      const current = existing.get(d.id)
      const kind = !current ? 'create' : shiftDiffers(current, d, r.value) ? 'update' : 'keep'
      plan.push({ kind, desired: d, times: r.value, current })
    }
    const wanted = new Set(desired.map(d => d.id))
    const cancels = [...existing.values()].filter(s => !wanted.has(s.id) && s.status !== 'cancelled')

    // Offers and swaps on shifts this publish changes or removes close with
    // them: they were made against a shift that no longer exists as it was.
    const touched = [...plan.filter(p => p.kind === 'update').map(p => p.current), ...cancels]
    const locks = await Promise.all(touched.filter(s => s.openOfferId || s.swapId).map(s => readLocks(tx, db, bizId, s)))

    // ---- writes ----
    const at = Timestamp.fromDate(now)
    for (const w of rosterWrites(employees, staffSnap, now)) tx.set(db.doc(paths.staff(bizId, w.id)), w.data, { merge: true })
    locks.forEach(l => writeReleaseLocks(tx, db, bizId, l, now, 'hengam_republished'))

    let created = 0
    let updated = 0
    // Who to tell: on the first publish of a week, everyone on it; after
    // that, everyone whose shifts changed, gained or lost.
    const shiftCounts = {}
    const affected = new Set()
    for (const p of plan) {
      const a = uidByStaff.get(p.desired.staffId)
      if (a) shiftCounts[a] = (shiftCounts[a] || 0) + 1
      if (p.kind !== 'keep') {
        if (a) affected.add(a)
        if (p.current?.assigneeUid) affected.add(p.current.assigneeUid)
      }
    }
    cancels.forEach(s => s.assigneeUid && affected.add(s.assigneeUid))
    for (const p of plan) {
      const ref = db.doc(paths.shift(bizId, p.desired.id))
      const assigneeUid = uidByStaff.get(p.desired.staffId) ?? null
      if (p.kind === 'keep') {
        // Same shift, perhaps from a newer Hengam version: only the
        // pointer back to Hengam moves.
        tx.update(ref, { hengamRef: p.desired.hengamRef, published: true })
        continue
      }
      const shift = {
        scheduleId: weekStart, staffId: p.desired.staffId, staffName: p.desired.staffName, assigneeUid,
        date: p.times.date, startLocal: p.times.startLocal, endLocal: p.times.endLocal, overnight: p.times.overnight,
        minutes: p.times.minutes, startAt: Timestamp.fromDate(p.times.startAt), endAt: Timestamp.fromDate(p.times.endAt),
        positionName: p.desired.positionName, notes: p.current?.notes || null,
        published: true, status: 'scheduled', origin: 'hengam', hengamRef: p.desired.hengamRef,
        openOfferId: null, swapId: null,
        version: (p.current?.version || 0) + 1, createdAt: p.current?.createdAt || at, updatedAt: at,
      }
      tx.set(ref, shift)
      if (p.current?.assigneeUid && p.current.assigneeUid !== assigneeUid) clearBusyBlock(tx, db, bizId, p.desired.id, p.current.assigneeUid)
      writeBusyBlock(tx, db, bizId, p.desired.id, shift)
      if (p.kind === 'create') created++
      else updated++
    }
    for (const s of cancels) {
      tx.update(db.doc(paths.shift(bizId, s.id)), { status: 'cancelled', cancelledAt: at, version: (s.version || 0) + 1, updatedAt: at, openOfferId: null, swapId: null })
      clearBusyBlock(tx, db, bizId, s.id, s.assigneeUid)
    }

    tx.set(db.doc(paths.schedule(bizId, weekStart)), {
      weekStart, status: 'published', source: 'hengam', sourceRef: scheduleId, sourceHash: fingerprint,
      publishedAt: at, publishedBy: uid, updatedAt: at, version: (teamsSchedule?.version || 0) + 1,
      ...(teamsSchedule ? {} : { createdAt: at }),
    })
    tx.update(hengamRef, { teamsPublishedAt: at, teamsBizId: bizId })
    audit(tx, db, bizId, uid, 'hengam.published', {
      scheduleId, weekStart, created, updated, cancelled: cancels.length,
    }, now)
    const version = (teamsSchedule?.version || 0) + 1
    const notify = teamsSchedule
      ? [...affected].map(to => ({ kind: 'scheduleChanged', bizId, to, params: { weekStart, version } }))
      : Object.entries(shiftCounts).map(([to, shiftCount]) => ({ kind: 'schedulePublished', bizId, to, params: { weekStart, version, shiftCount } }))
    return { unchanged: false, weekStart, created, updated, cancelled: cancels.length, notify }
  })
}
