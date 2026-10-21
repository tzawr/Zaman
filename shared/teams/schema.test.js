import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRANSITIONS, canTransition, initialStatus, isFinal, paths, statusesOf } from './schema.js'

test('every move in every machine lands on a status that machine defines', () => {
  for (const [machine, table] of Object.entries(TRANSITIONS)) {
    const known = new Set(Object.keys(table))
    for (const [from, targets] of Object.entries(table)) {
      for (const to of targets) {
        assert.ok(known.has(to), `${machine}: ${from} -> ${to} goes to an undefined status`)
        assert.notEqual(from, to, `${machine}: ${from} moves to itself`)
      }
    }
  }
})

test('every status is reachable from the initial one', () => {
  for (const machine of Object.keys(TRANSITIONS)) {
    const seen = new Set([initialStatus(machine)])
    const queue = [initialStatus(machine)]
    while (queue.length) {
      for (const next of TRANSITIONS[machine][queue.shift()]) {
        if (!seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
    assert.deepEqual([...seen].sort(), statusesOf(machine).sort(), `${machine} has unreachable statuses`)
  }
})

test('final statuses cannot be left', () => {
  for (const machine of ['offer', 'claim', 'swap', 'timeOff']) {
    for (const status of statusesOf(machine)) {
      if (!isFinal(machine, status)) continue
      for (const to of statusesOf(machine)) assert.equal(canTransition(machine, status, to), false)
    }
  }
})

test('the marketplace rules the product depends on', () => {
  // A rejected claim puts the shift back on the market.
  assert.ok(canTransition('offer', 'pending', 'available'))
  // An offer cannot be approved without a claim having made it pending.
  assert.equal(canTransition('offer', 'available', 'approved'), false)
  // A swap with no manager step approves straight from the peer's acceptance.
  assert.ok(canTransition('swap', 'pending_peer', 'approved'))
  // A completed transfer is history.
  assert.ok(isFinal('swap', 'completed'))
  // An import is never published without passing through review.
  assert.equal(canTransition('importJob', 'extracting', 'published'), false)
})

test('unknown machines and statuses are refused, not guessed', () => {
  assert.equal(canTransition('offer', 'nonsense', 'available'), false)
  assert.equal(canTransition('nope', 'a', 'b'), false)
  assert.throws(() => statusesOf('nope'))
})

test('every business path stays inside its business', () => {
  for (const [name, build] of Object.entries(paths)) {
    if (['workplace', 'notification', 'device', 'busyBlock', 'calendarFeed'].includes(name)) continue
    const path = build('biz1', 'a', 'b')
    assert.ok(path.startsWith('businesses/biz1'), `${name} -> ${path}`)
    assert.equal(path.split('/').length % 2, 0, `${name} is not a document path`)
  }
})
