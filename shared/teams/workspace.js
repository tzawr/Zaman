// Rules for workspaces, memberships and invites that do not depend on where
// they run. The server enforces them inside its transactions; the app uses the
// same functions to decide which controls to offer, so a button the server
// would refuse is never shown.

import { MANAGER_ROLES, ROLES } from './schema.js'

export const BUSINESS_NAME_MAX = 80
export const PERSON_NAME_MAX = 80
export const INVITE_TTL_DAYS = 14

export function cleanName(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

export function validateBusinessName(value) {
  const name = cleanName(value, BUSINESS_NAME_MAX + 1)
  if (!name) return { ok: false, message: 'Give your workspace a name.' }
  if (name.length > BUSINESS_NAME_MAX) return { ok: false, message: `Keep the name under ${BUSINESS_NAME_MAX} characters.` }
  return { ok: true, value: name }
}

export function validatePersonName(value) {
  const name = cleanName(value, PERSON_NAME_MAX + 1)
  if (!name) return { ok: false, message: 'Enter their name.' }
  if (name.length > PERSON_NAME_MAX) return { ok: false, message: `Keep the name under ${PERSON_NAME_MAX} characters.` }
  return { ok: true, value: name }
}

export function isValidTimezone(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function isManagerRole(role) {
  return MANAGER_ROLES.includes(role)
}

export function isActive(member) {
  return member?.status === 'active'
}

// Owners and managers invite; only an owner hands out manager or owner rights.
export function canInvite(actor, role) {
  if (!isActive(actor) || !ROLES.includes(role)) return false
  if (role === 'employee') return isManagerRole(actor.role)
  return actor.role === 'owner'
}

// Who may change whose role. Managers manage employees; owners manage
// everyone; nobody demotes the last owner, which would leave the workspace
// with no one able to run it.
export function canChangeRole(actor, target, nextRole, ownerCount) {
  if (!isActive(actor) || !isActive(target) || !ROLES.includes(nextRole)) return false
  if (target.role === nextRole) return false
  if (actor.role !== 'owner') return false
  if (target.role === 'owner' && ownerCount <= 1) return false
  return true
}

export function canRemove(actor, target, ownerCount) {
  if (!isActive(actor) || !isActive(target)) return false
  if (target.role === 'owner') return actor.role === 'owner' && ownerCount > 1
  if (target.role === 'manager') return actor.role === 'owner'
  return isManagerRole(actor.role)
}

export function canLeave(member, ownerCount) {
  if (!isActive(member)) return false
  return member.role !== 'owner' || ownerCount > 1
}

// Invite codes are typed by hand as often as they are tapped, so they use
// Crockford's base32: no I, L, O or U, and the confusable letters are read as
// the digits they look like. Ten characters is 50 bits; with the server's
// rate limit on guesses that is far out of reach of brute force.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const INVITE_CODE_LENGTH = 10

export function generateInviteCode(randomBytes) {
  const bytes = randomBytes(INVITE_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += ALPHABET[bytes[i] & 31]
  return code
}

export function normalizeInviteCode(input) {
  if (typeof input !== 'string') return ''
  // A pasted link works as well as a typed code.
  const fromLink = input.match(/\/join\/([^/?#\s]+)/i)
  const raw = (fromLink ? fromLink[1] : input).toUpperCase()
  const code = raw
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (code.length !== INVITE_CODE_LENGTH) return ''
  for (const ch of code) if (!ALPHABET.includes(ch)) return ''
  return code
}

export function formatInviteCode(code) {
  return code ? `${code.slice(0, 5)}-${code.slice(5)}` : ''
}

export function inviteExpiry(now = new Date()) {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
}

// Why an invite cannot be accepted, or null if it can.
export function inviteProblem(invite, now = new Date()) {
  if (!invite) return 'not_found'
  if (invite.status === 'revoked') return 'revoked'
  if (invite.status === 'accepted') return 'used'
  if (invite.status !== 'open') return 'not_found'
  const expires = invite.expiresAt instanceof Date ? invite.expiresAt : invite.expiresAt?.toDate?.()
  if (!expires || expires <= now) return 'expired'
  return null
}

export const INVITE_PROBLEM_MESSAGES = {
  not_found: 'That invite code does not match any workspace. Check it with whoever sent it.',
  revoked: 'This invite was cancelled. Ask your manager for a new one.',
  used: 'This invite has already been used. Ask your manager for a new one.',
  expired: 'This invite has expired. Ask your manager for a new one.',
}
