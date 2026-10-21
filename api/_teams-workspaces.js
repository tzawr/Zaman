import { randomBytes } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { DEFAULT_POLICIES, ROLES, canTransition, paths } from '../shared/teams/schema.js'
import {
  INVITE_PROBLEM_MESSAGES, canChangeRole, canInvite, canLeave, canRemove, cleanName,
  generateInviteCode, inviteExpiry, inviteProblem, isActive, isValidTimezone,
  normalizeInviteCode, validateBusinessName, validatePersonName,
} from '../shared/teams/workspace.js'
import { TeamsError, conflict, forbidden, invalid, notFound } from './_teams-http.js'
import { audit, countOwners, readActor, requireId, requireString, sha256 } from './_teams-common.js'
import { writeBusyBlock } from './_teams-assignments.js'

// Workspaces, memberships and invites. Each workflow is one Firestore
// transaction: it reads what it depends on, checks the rules in
// shared/teams/workspace.js against what it read, and writes everything or
// nothing. Every change leaves an audit entry in the same transaction.
//
// Each takes { db, uid, token, input, now } and returns plain JSON.

// The name a new member is shown by when they did not give one.
function fallbackName(token) {
  return cleanName(token?.name, 80) || cleanName(String(token?.email || '').split('@')[0], 80) || 'Me'
}

export async function createBusiness({ db, uid, token, input, now }) {
  if (token?.email_verified !== true) {
    throw forbidden('Verify your email address before creating a workspace.')
  }
  const name = validateBusinessName(input.name)
  if (!name.ok) throw invalid(name.message)
  const timezone = requireString(input.timezone, 'Choose a time zone.')
  if (!isValidTimezone(timezone)) throw invalid('Choose a valid time zone.')
  // The app sends one id per attempt, so a double tap or a retried request
  // lands on the same workspace instead of making two.
  const requestId = requireString(input.requestId, 'Missing request id.')
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw invalid('Invalid request id.')
  const ownerName = input.ownerName ? validatePersonName(input.ownerName) : { ok: true, value: fallbackName(token) }
  if (!ownerName.ok) throw invalid(ownerName.message)

  const bizId = sha256(`${uid}:${requestId}`).slice(0, 20)
  const bizRef = db.doc(paths.business(bizId))
  const staffId = db.collection(`businesses/${bizId}/staff`).doc().id

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(bizRef)
    if (existing.exists) {
      if (existing.data().createdBy === uid) return { bizId, created: false }
      throw conflict('conflict', 'Something went wrong creating your workspace. Try again.')
    }

    const at = Timestamp.fromDate(now)
    tx.set(bizRef, { name: name.value, mode: 'standalone', timezone, createdBy: uid, createdAt: at })
    tx.set(db.doc(paths.member(bizId, uid)), {
      role: 'owner', status: 'active', staffId, displayName: ownerName.value, joinedAt: at,
    })
    tx.set(db.doc(paths.staff(bizId, staffId)), {
      name: ownerName.value, uid, positionIds: [], locationIds: [], createdAt: at,
    })
    tx.set(db.doc(paths.staffPrivate(bizId, staffId)), { uid, email: token?.email || null })
    tx.set(db.doc(paths.policies(bizId)), { ...DEFAULT_POLICIES, updatedAt: at })
    tx.set(db.doc(paths.workplace(uid, bizId)), { name: name.value, role: 'owner', joinedAt: at })
    audit(tx, db, bizId, uid, 'business.created', { name: name.value }, now)
    return { bizId, created: true }
  })
}

export async function createInvite({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const role = input.role || 'employee'
  if (!ROLES.includes(role)) throw invalid('Choose a role.')
  const staffIdInput = input.staffId ? requireId(input.staffId, 'person') : null
  const name = staffIdInput ? null : validatePersonName(input.name)
  if (name && !name.ok) throw invalid(name.message)
  const email = typeof input.email === 'string' ? input.email.trim().slice(0, 254) : ''
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('That email address does not look right.')

  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    if (!canInvite(actor, role)) {
      throw forbidden(role === 'employee'
        ? 'Only managers can invite people.'
        : 'Only an owner can invite managers or owners.')
    }

    let staffId = staffIdInput
    let staffName = name?.value
    // A Hengam workspace's roster comes from Hengam, so invites go to people
    // already on it.
    if (!staffId) {
      const biz = await tx.get(db.doc(paths.business(bizId)))
      if (biz.data()?.mode === 'hengam') throw invalid('Add them as an employee in Hengam first, then invite them here.')
    }
    if (staffId) {
      const staffSnap = await tx.get(db.doc(paths.staff(bizId, staffId)))
      if (!staffSnap.exists) throw notFound('That person is not on your team.')
      if (staffSnap.data().uid) throw conflict('already_linked', `${staffSnap.data().name} already has an account in this workspace.`)
      staffName = staffSnap.data().name
    }

    // Collisions at 50 bits are not a real concern, but a duplicate would
    // silently hand one workspace's invite to another, so check anyway.
    let code
    let codeRef
    for (let attempt = 0; attempt < 3; attempt++) {
      code = generateInviteCode(randomBytes)
      codeRef = db.doc(paths.inviteCode(sha256(code)))
      if (!(await tx.get(codeRef)).exists) break
      code = null
    }
    if (!code) throw new Error('could not allocate an invite code')

    const at = Timestamp.fromDate(now)
    if (!staffId) {
      const staffRef = db.collection(`businesses/${bizId}/staff`).doc()
      staffId = staffRef.id
      tx.set(staffRef, { name: staffName, positionIds: [], locationIds: [], createdAt: at })
      tx.set(db.doc(paths.staffPrivate(bizId, staffId)), { email: email || null })
    }

    const inviteRef = db.collection(`businesses/${bizId}/invites`).doc()
    const expiresAt = Timestamp.fromDate(inviteExpiry(now))
    // The code is kept on the invite so a manager can share it again. Only
    // that business's managers can read it.
    tx.set(inviteRef, {
      code, role, staffId, staffName, status: 'open', createdBy: uid, createdAt: at, expiresAt,
    })
    tx.set(codeRef, { bizId, inviteId: inviteRef.id, createdAt: at })
    audit(tx, db, bizId, uid, 'invite.created', { inviteId: inviteRef.id, role, staffId }, now)
    return { inviteId: inviteRef.id, staffId, code, expiresAt: expiresAt.toDate().toISOString() }
  })
}

async function readInviteByCode(tx, db, rawCode) {
  const code = normalizeInviteCode(rawCode)
  if (!code) throw invalid('Enter the 10-character code from your invite.')
  const codeSnap = await tx.get(db.doc(paths.inviteCode(sha256(code))))
  if (!codeSnap.exists) throw notFound(INVITE_PROBLEM_MESSAGES.not_found)
  const { bizId, inviteId } = codeSnap.data()
  const [inviteSnap, bizSnap] = await Promise.all([
    tx.get(db.doc(paths.invite(bizId, inviteId))),
    tx.get(db.doc(paths.business(bizId))),
  ])
  if (!inviteSnap.exists || !bizSnap.exists) throw notFound(INVITE_PROBLEM_MESSAGES.not_found)
  return { bizId, inviteId, invite: inviteSnap.data(), business: bizSnap.data() }
}

const PROBLEM_STATUS = { not_found: 404, revoked: 410, used: 410, expired: 410 }

// Shown before someone signs in, so it says only what the invite is for.
export async function previewInvite({ db, input, now }) {
  return db.runTransaction(async (tx) => {
    const { invite, business } = await readInviteByCode(tx, db, input.code)
    const problem = inviteProblem(invite, now)
    if (problem) throw new TeamsError(PROBLEM_STATUS[problem], `invite_${problem}`, INVITE_PROBLEM_MESSAGES[problem])
    return { businessName: business.name, role: invite.role, name: invite.staffName }
  })
}

export async function acceptInvite({ db, uid, token, input, now }) {
  return db.runTransaction(async (tx) => {
    const { bizId, inviteId, invite, business } = await readInviteByCode(tx, db, input.code)
    // Accepting twice, say after a dropped response, is not an error.
    if (invite.status === 'accepted' && invite.acceptedBy === uid) {
      return { bizId, businessName: business.name, alreadyMember: true }
    }
    const problem = inviteProblem(invite, now)
    if (problem) throw new TeamsError(PROBLEM_STATUS[problem], `invite_${problem}`, INVITE_PROBLEM_MESSAGES[problem])
    if (!canTransition('invite', invite.status, 'accepted')) throw conflict('invite_used', INVITE_PROBLEM_MESSAGES.used)

    const memberRef = db.doc(paths.member(bizId, uid))
    const staffRef = db.doc(paths.staff(bizId, invite.staffId))
    const [memberSnap, staffSnap] = await Promise.all([tx.get(memberRef), tx.get(staffRef)])
    if (memberSnap.exists && isActive(memberSnap.data())) {
      throw conflict('already_member', `You are already a member of ${business.name}.`)
    }
    if (!staffSnap.exists) throw notFound(INVITE_PROBLEM_MESSAGES.not_found)
    if (staffSnap.data().uid && staffSnap.data().uid !== uid) {
      throw conflict('already_linked', 'Someone else has already joined as this person. Ask your manager for a new invite.')
    }

    // Shifts already scheduled for this roster entry become theirs to see.
    // Rules show an employee the shifts whose assigneeUid is theirs.
    const shiftsSnap = await tx.get(db.collection(`businesses/${bizId}/shifts`)
      .where('staffId', '==', invite.staffId).limit(450))

    const at = Timestamp.fromDate(now)
    const displayName = staffSnap.data().name
    shiftsSnap.docs.forEach(d => {
      tx.update(d.ref, { assigneeUid: uid })
      writeBusyBlock(tx, db, bizId, d.id, { ...d.data(), assigneeUid: uid })
    })
    tx.set(memberRef, {
      role: invite.role, status: 'active', staffId: invite.staffId, displayName, joinedAt: at,
    })
    tx.update(staffRef, { uid })
    tx.set(db.doc(paths.staffPrivate(bizId, invite.staffId)), {
      uid, accountEmail: token?.email || null,
    }, { merge: true })
    tx.update(db.doc(paths.invite(bizId, inviteId)), {
      status: 'accepted', acceptedBy: uid, acceptedAt: at,
    })
    tx.set(db.doc(paths.workplace(uid, bizId)), { name: business.name, role: invite.role, joinedAt: at })
    audit(tx, db, bizId, uid, 'invite.accepted', { inviteId, staffId: invite.staffId, role: invite.role }, now)
    return { bizId, businessName: business.name, alreadyMember: false }
  })
}

export async function revokeInvite({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const inviteId = requireId(input.inviteId, 'invite')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const inviteRef = db.doc(paths.invite(bizId, inviteId))
    const inviteSnap = await tx.get(inviteRef)
    if (!inviteSnap.exists) throw notFound('That invite no longer exists.')
    const invite = inviteSnap.data()
    if (!canInvite(actor, invite.role)) throw forbidden('You cannot cancel this invite.')
    if (!canTransition('invite', invite.status, 'revoked')) {
      throw conflict('invite_closed', 'This invite has already been used or cancelled.')
    }
    tx.update(inviteRef, { status: 'revoked', revokedBy: uid, revokedAt: Timestamp.fromDate(now) })
    tx.delete(db.doc(paths.inviteCode(sha256(invite.code))))
    audit(tx, db, bizId, uid, 'invite.revoked', { inviteId }, now)
    return { ok: true }
  })
}

export async function updateMemberRole({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const targetUid = requireId(input.memberUid, 'member')
  const role = input.role
  if (!ROLES.includes(role)) throw invalid('Choose a role.')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const targetRef = db.doc(paths.member(bizId, targetUid))
    const targetSnap = await tx.get(targetRef)
    if (!targetSnap.exists) throw notFound('That person is not in this workspace.')
    const owners = await countOwners(tx, db, bizId)
    const target = targetSnap.data()
    if (!canChangeRole(actor, target, role, owners)) {
      throw forbidden(target.role === 'owner' && owners <= 1
        ? 'A workspace needs at least one owner. Make someone else an owner first.'
        : 'Only an owner can change roles.')
    }
    tx.update(targetRef, { role })
    tx.set(db.doc(paths.workplace(targetUid, bizId)), { role }, { merge: true })
    audit(tx, db, bizId, uid, 'member.role_changed', { memberUid: targetUid, from: target.role, to: role }, now)
    return { ok: true }
  })
}

// Removing someone keeps their roster entry, so past shifts still say who
// worked them, but unlinks it from their account.
// Their entries in the busy index for this business, which go with them.
async function readBusyBlocksHere(tx, db, bizId, memberUid) {
  return tx.get(db.collection(`userBusy/${memberUid}/blocks`).where('bizId', '==', bizId))
}

function writeRemoval(tx, db, bizId, member, memberUid, now, busySnap) {
  busySnap?.docs.forEach(d => tx.delete(d.ref))
  tx.update(db.doc(paths.member(bizId, memberUid)), { status: 'removed', removedAt: Timestamp.fromDate(now) })
  if (member.staffId) {
    tx.update(db.doc(paths.staff(bizId, member.staffId)), { uid: FieldValue.delete() })
    tx.set(db.doc(paths.staffPrivate(bizId, member.staffId)), { uid: FieldValue.delete() }, { merge: true })
  }
  tx.delete(db.doc(paths.workplace(memberUid, bizId)))
}

export async function removeMember({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  const targetUid = requireId(input.memberUid, 'member')
  if (targetUid === uid) throw invalid('To leave a workspace, use Leave instead.')
  return db.runTransaction(async (tx) => {
    const actor = await readActor(tx, db, bizId, uid)
    const targetSnap = await tx.get(db.doc(paths.member(bizId, targetUid)))
    if (!targetSnap.exists || !isActive(targetSnap.data())) throw notFound('That person is not in this workspace.')
    const [owners, busySnap] = await Promise.all([countOwners(tx, db, bizId), readBusyBlocksHere(tx, db, bizId, targetUid)])
    const target = targetSnap.data()
    if (!canRemove(actor, target, owners)) {
      throw forbidden(target.role === 'employee'
        ? 'Only managers can remove people.'
        : 'Only an owner can remove a manager or another owner.')
    }
    writeRemoval(tx, db, bizId, target, targetUid, now, busySnap)
    audit(tx, db, bizId, uid, 'member.removed', { memberUid: targetUid, role: target.role }, now)
    return { ok: true }
  })
}

export async function leaveBusiness({ db, uid, input, now }) {
  const bizId = requireId(input.bizId, 'workspace')
  return db.runTransaction(async (tx) => {
    const member = await readActor(tx, db, bizId, uid)
    const [owners, busySnap] = await Promise.all([countOwners(tx, db, bizId), readBusyBlocksHere(tx, db, bizId, uid)])
    if (!canLeave(member, owners)) {
      throw forbidden('You are the only owner. Make someone else an owner before you leave.')
    }
    writeRemoval(tx, db, bizId, member, uid, now, busySnap)
    audit(tx, db, bizId, uid, 'member.left', {}, now)
    return { ok: true }
  })
}

// Erasing an account takes it out of every workspace first, the same way
// leaving does. A workspace with nobody else left in it goes with the
// account. Refuses, before changing anything, while the account is the only
// owner of a workspace that still has other people in it.
export async function leaveAllForDeletion({ db, uid, now }) {
  const workplaces = await db.collection(`users/${uid}/workplaces`).get()
  const blocking = []
  const solelyMine = new Set()
  for (const workplace of workplaces.docs) {
    const bizId = workplace.id
    const [member, owners, active] = await Promise.all([
      db.doc(paths.member(bizId, uid)).get(),
      db.collection(`businesses/${bizId}/members`).where('role', '==', 'owner').where('status', '==', 'active').count().get(),
      db.collection(`businesses/${bizId}/members`).where('status', '==', 'active').count().get(),
    ])
    const isOwner = member.data()?.role === 'owner' && isActive(member.data())
    if (isOwner && owners.data().count <= 1 && active.data().count > 1) {
      blocking.push(workplace.data().name || bizId)
    }
    if (isOwner && active.data().count === 1) solelyMine.add(bizId)
  }
  if (blocking.length) return { ok: false, blocking }

  for (const workplace of workplaces.docs) {
    const bizId = workplace.id
    if (solelyMine.has(bizId)) {
      await db.recursiveDelete(db.doc(paths.business(bizId)))
      await db.doc(paths.workplace(uid, bizId)).delete()
      continue
    }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.doc(paths.member(bizId, uid)))
      if (!snap.exists || !isActive(snap.data())) {
        tx.delete(db.doc(paths.workplace(uid, bizId)))
        return
      }
      writeRemoval(tx, db, bizId, snap.data(), uid, now)
      audit(tx, db, bizId, uid, 'member.account_deleted', {}, now)
    })
  }
  return { ok: true, blocking: [] }
}
