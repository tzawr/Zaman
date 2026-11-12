import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { authErrorMessage, AUTH_MESSAGE_KEYS, EXPECTED_AUTH_ERRORS } from './authErrors.js'

const t = (k) => `T:${k}`

test('HQA-18: a blocked domain or pop-up gets its own message, not the generic one', () => {
  assert.equal(authErrorMessage('auth/unauthorized-domain', t), 'T:authGoogleUnavailable')
  assert.equal(authErrorMessage('auth/popup-blocked', t), 'T:authPopupBlocked')
  assert.equal(authErrorMessage('auth/user-disabled', t), 'T:authUserDisabled')
  assert.equal(authErrorMessage('auth/network-request-failed', t), 'T:authNetwork')
  assert.equal(authErrorMessage('auth/invalid-credential', t), 'T:authInvalidCredential')
})

test('closing the Google window shows nothing', () => {
  for (const c of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']) assert.equal(authErrorMessage(c, t), '')
})

test('unknown codes still fall back to the generic message', () => {
  assert.equal(authErrorMessage('auth/something-new', t), 'T:authGeneric')
  assert.equal(authErrorMessage(undefined, t), 'T:authGeneric')
})

test('service problems are reported to monitoring; the person\'s own input is not', () => {
  for (const c of ['auth/unauthorized-domain', 'auth/internal-error', 'auth/network-request-failed', 'auth/too-many-requests', 'auth/popup-blocked']) assert.ok(!EXPECTED_AUTH_ERRORS.has(c), c)
  for (const c of ['auth/invalid-credential', 'auth/popup-closed-by-user', 'auth/weak-password']) assert.ok(EXPECTED_AUTH_ERRORS.has(c), c)
})

test('every message exists in English and Persian', () => {
  const src = readFileSync(new URL('../i18n.jsx', import.meta.url), 'utf8')
  for (const key of AUTH_MESSAGE_KEYS) assert.equal((src.match(new RegExp(`^\\s+${key}:`, 'gm')) || []).length, 2, key)
})
