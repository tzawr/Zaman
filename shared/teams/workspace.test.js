import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  canChangeRole, canInvite, canLeave, canRemove, formatInviteCode, generateInviteCode,
  inviteProblem, isValidTimezone, normalizeInviteCode, validateBusinessName,
} from './workspace.js'

const owner = { role: 'owner', status: 'active' }
const manager = { role: 'manager', status: 'active' }
const employee = { role: 'employee', status: 'active' }
const removed = { role: 'manager', status: 'removed' }

test('names are trimmed, collapsed and bounded', () => {
  assert.deepEqual(validateBusinessName('  Blue   Door  Cafe '), { ok: true, value: 'Blue Door Cafe' })
  assert.equal(validateBusinessName('   ').ok, false)
  assert.equal(validateBusinessName('x'.repeat(81)).ok, false)
  assert.equal(validateBusinessName(42).ok, false)
})

test('timezones must be real IANA zones', () => {
  assert.ok(isValidTimezone('America/Los_Angeles'))
  assert.equal(isValidTimezone('Mars/Olympus'), false)
  assert.equal(isValidTimezone(''), false)
})

test('only owners hand out manager or owner rights', () => {
  assert.ok(canInvite(manager, 'employee'))
  assert.equal(canInvite(manager, 'manager'), false)
  assert.ok(canInvite(owner, 'manager'))
  assert.equal(canInvite(employee, 'employee'), false)
  assert.equal(canInvite(removed, 'employee'), false)
  assert.equal(canInvite(owner, 'admin'), false)
})

test('the last owner can be neither demoted, removed, nor leave', () => {
  assert.equal(canChangeRole(owner, owner, 'manager', 1), false)
  assert.ok(canChangeRole(owner, { ...owner }, 'manager', 2))
  assert.equal(canRemove(owner, owner, 1), false)
  assert.ok(canRemove(owner, owner, 2))
  assert.equal(canLeave(owner, 1), false)
  assert.ok(canLeave(employee, 1))
})

test('managers manage employees, not each other', () => {
  assert.ok(canRemove(manager, employee, 1))
  assert.equal(canRemove(manager, manager, 1), false)
  assert.equal(canRemove(manager, owner, 2), false)
  assert.equal(canChangeRole(manager, employee, 'manager', 1), false)
  assert.equal(canRemove(employee, employee, 1), false)
  assert.equal(canChangeRole(owner, employee, 'employee', 1), false)
})

test('invite codes survive the ways people retype them', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateInviteCode(randomBytes)
    assert.equal(code.length, 10)
    assert.equal(normalizeInviteCode(code), code)
    assert.equal(normalizeInviteCode(formatInviteCode(code).toLowerCase()), code)
  }
  assert.equal(normalizeInviteCode('o1l1o-abcde'), '01110ABCDE')
  assert.equal(normalizeInviteCode('https://teams.hengam.app/join/ABCDE-12345?x=1'), 'ABCDE12345')
  assert.equal(normalizeInviteCode('ABCDEU2345'), '')
  assert.equal(normalizeInviteCode('short'), '')
  assert.equal(normalizeInviteCode(null), '')
})

test('an invite is usable only while open and unexpired', () => {
  const now = new Date('2026-10-20T12:00:00Z')
  const open = { status: 'open', expiresAt: new Date('2026-10-21T00:00:00Z') }
  assert.equal(inviteProblem(open, now), null)
  assert.equal(inviteProblem({ ...open, expiresAt: { toDate: () => new Date('2026-10-01') } }, now), 'expired')
  assert.equal(inviteProblem({ ...open, status: 'accepted' }, now), 'used')
  assert.equal(inviteProblem({ ...open, status: 'revoked' }, now), 'revoked')
  assert.equal(inviteProblem(null, now), 'not_found')
  assert.equal(inviteProblem({ status: 'open' }, now), 'expired')
})
