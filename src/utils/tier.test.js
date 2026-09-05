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

test('tier values are matched regardless of casing or stray whitespace', () => {
  // These get set by hand in the Firebase console and by billing webhooks.
  for (const value of ['pro', 'Pro', 'PRO', ' pro ', 'business', 'Business']) {
    assert.equal(resolveTierFromData({ user: { tier: value } }), 'pro', `${value} should resolve to pro`)
  }
  for (const value of ['free', 'Free', '', null, undefined, 'premium']) {
    assert.equal(resolveTierFromData({ user: { tier: value } }), 'free', `${value} should resolve to free`)
  }
})

test('export format matching ignores casing', () => {
  assert.equal(canExportFormatForTier('free', 'CSV').blocked, false)
  assert.equal(canExportFormatForTier('free', 'PDF').blocked, true)
})

test('a missing count is not treated as being under the limit', () => {
  assert.equal(canAddEmployeeForTier('free', 5).blocked, true)
  assert.equal(canAddEmployeeForTier('free', NaN).blocked, false)
  assert.equal(canGenerateScheduleForTier('free', undefined).blocked, false)
})
