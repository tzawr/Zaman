import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAddEmployeeForTier,
  canGenerateScheduleForTier,
  canExportFormatForTier,
  resolveTierFromData,
} from './tierCore.js'

const now = Date.parse('2026-05-05T00:00:00Z')

test('free user at employee limit is blocked', () => {
  assert.equal(canAddEmployeeForTier('free', 5).blocked, true)
})

test('free user under employee limit is allowed', () => {
  assert.equal(canAddEmployeeForTier('free', 4).blocked, false)
})

test('pro user has unlimited generation access', () => {
  assert.equal(canGenerateScheduleForTier('pro', 100).blocked, false)
  assert.equal(canExportFormatForTier('pro', 'pdf').blocked, false)
})

test('active override wins', () => {
  const tier = resolveTierFromData({
    user: { tier: 'free' },
    override: { tier: 'pro', expiresAt: { seconds: (now / 1000) + 60 } },
  }, now)
  assert.equal(tier, 'pro')
})

test('expired override falls back to user tier', () => {
  const tier = resolveTierFromData({
    user: { tier: 'free' },
    override: { tier: 'pro', expiresAt: { seconds: (now / 1000) - 60 } },
  }, now)
  assert.equal(tier, 'free')
})

test('override wins over subscription tier', () => {
  const tier = resolveTierFromData({
    user: { tier: 'pro' },
    override: { tier: 'free', expiresAt: null },
  }, now)
  assert.equal(tier, 'free')
})
