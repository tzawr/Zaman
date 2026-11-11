import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RuleParseError, errorForResponse, extractRulesJson, hasWrittenRules, rulesOutcome, rulesStep } from './ruleParsing.js'

test('written rules are detected from either field, ignoring whitespace', () => {
  assert.equal(hasWrittenRules('', ''), false)
  assert.equal(hasWrittenRules('  \n', null), false)
  assert.equal(hasWrittenRules('Two openers', ''), true)
  assert.equal(hasWrittenRules(undefined, 'Ana off Monday'), true)
})

test('a valid reply parses, with or without code fences and chatter', () => {
  assert.deepEqual(extractRulesJson('{"coverage":{}}'), { coverage: {} })
  assert.deepEqual(extractRulesJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractRulesJson('Here you go: {"a":1} hope that helps'), { a: 1 })
})

test('an empty, truncated or non-object reply is an error, never "no rules"', () => {
  for (const reply of ['', 'Sorry, I cannot help', '{"coverage": {', '[1,2]', '{not json}', null]) {
    assert.throws(() => extractRulesJson(reply), (e) => e instanceof RuleParseError && e.kind === 'unreadable', String(reply))
  }
})

test('API failures map to reasons the manager can act on', () => {
  assert.equal(errorForResponse(429, { message: 'Limit reached' }).kind, 'limit')
  assert.equal(errorForResponse(429, { message: 'Limit reached' }).serverMessage, 'Limit reached')
  assert.equal(errorForResponse(401).kind, 'signin')
  for (const s of [500, 502, 503, 0]) assert.equal(errorForResponse(s).kind, 'unavailable')
})

test('the rules step never skips rules unless the manager chose to or the plan excludes them', () => {
  assert.equal(rulesStep({ hasRules: false, planAllows: true, skipRules: false }), 'none')
  assert.equal(rulesStep({ hasRules: true, planAllows: true, skipRules: false }), 'parse')
  assert.equal(rulesStep({ hasRules: true, planAllows: true, skipRules: true }), 'skipped')
  assert.equal(rulesStep({ hasRules: true, planAllows: false, skipRules: false }), 'plan')
})

test('the saved schedule records whether the rules were used, and why not', () => {
  assert.deepEqual(rulesOutcome('parse'), { rulesApplied: true, rulesSkippedReason: null })
  assert.deepEqual(rulesOutcome('none'), { rulesApplied: null, rulesSkippedReason: null })
  assert.deepEqual(rulesOutcome('skipped'), { rulesApplied: false, rulesSkippedReason: 'manager_choice' })
  assert.deepEqual(rulesOutcome('plan'), { rulesApplied: false, rulesSkippedReason: 'plan' })
})
