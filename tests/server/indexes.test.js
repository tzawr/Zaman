import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The emulators do not enforce composite indexes, so a query that needs one
// passes every local test and fails in production. Each such query is listed
// here with the index it needs.
const indexes = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')).indexes
const has = (group, fields, scope = 'COLLECTION') => indexes.some(i => i.collectionGroup === group && (i.queryScope || 'COLLECTION') === scope &&
  i.fields.map(f => f.fieldPath).join(',') === fields.join(','))

test('email retries (status IN + nextAttemptAt range) have their index', () => {
  assert.ok(has('emailOutbox', ['status', 'nextAttemptAt']))
})

test('daily job queries have their indexes', () => {
  assert.ok(has('shifts', ['published', 'startAt'], 'COLLECTION_GROUP') || has('shifts', ['published', 'startAt']))
  assert.ok(has('offers', ['status', 'expiresAt'], 'COLLECTION_GROUP') || has('offers', ['status', 'expiresAt']))
  assert.ok(has('swaps', ['status', 'expiresAt'], 'COLLECTION_GROUP') || has('swaps', ['status', 'expiresAt']))
})

test('TTL cleanup on expireAt is declared for every notification collection', () => {
  const overrides = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')).fieldOverrides || []
  for (const group of ['notifications', 'emailOutbox', 'emailLog', 'emailEvents']) {
    assert.ok(overrides.some(o => o.collectionGroup === group && o.fieldPath === 'expireAt' && o.ttl === true), group)
  }
})
