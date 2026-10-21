import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshestRecord } from './freshestRecord.js'

const at = (seconds) => ({ seconds })

test('the newer submission wins', () => {
  const manager = { availability: { monday: { available: true } }, availabilityUpdatedAt: at(10) }
  const portal = { availability: { monday: { available: false } }, availabilityUpdatedAt: at(20) }
  assert.equal(freshestRecord([manager, portal], 'availability', 'availabilityUpdatedAt'), portal)
  assert.equal(freshestRecord([portal, { ...manager, availabilityUpdatedAt: at(30) }], 'availability', 'availabilityUpdatedAt').availabilityUpdatedAt.seconds, 30)
})

test('an empty or missing value never wins', () => {
  const filled = { timeOff: [{ from: '2026-01-01' }], timeOffUpdatedAt: at(1) }
  const empty = { timeOff: [], timeOffUpdatedAt: at(99) }
  assert.equal(freshestRecord([empty, null, filled], 'timeOff', 'timeOffUpdatedAt'), filled)
  assert.equal(freshestRecord([empty, null], 'timeOff', 'timeOffUpdatedAt'), undefined)
})

test('a Firestore Timestamp is read through toMillis', () => {
  const a = { availability: { x: 1 }, availabilityUpdatedAt: { toMillis: () => 5000 } }
  const b = { availability: { x: 2 }, availabilityUpdatedAt: at(4) }
  assert.equal(freshestRecord([b, a], 'availability', 'availabilityUpdatedAt'), a)
})
