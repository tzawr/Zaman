import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FEATURES, effectiveDarkMode, effectiveLanguage } from './features.js'

test('shipping state: English only, dark only', () => {
  assert.equal(FEATURES.persian, false)
  assert.equal(FEATURES.lightMode, false)
})

test('with Persian off, every request or saved preference resolves to English', () => {
  for (const v of ['fa', 'en', undefined, null, 'de', '']) assert.equal(effectiveLanguage(v), 'en')
})

test('with Persian on (reactivation), Persian requests are honoured again', () => {
  assert.equal(effectiveLanguage('fa', { persian: true }), 'fa')
  assert.equal(effectiveLanguage('en', { persian: true }), 'en')
  assert.equal(effectiveLanguage('xx', { persian: true }), 'en')
})

test('with light mode off, a saved light or system choice still gives dark', () => {
  for (const v of ['light', 'dark', 'system', null, undefined]) assert.equal(effectiveDarkMode(v), true)
})

test('with light mode on (reactivation), a saved light choice is honoured again', () => {
  assert.equal(effectiveDarkMode('light', { lightMode: true }), false)
  assert.equal(effectiveDarkMode('dark', { lightMode: true }), true)
  assert.equal(effectiveDarkMode(null, { lightMode: true }), true)
})
