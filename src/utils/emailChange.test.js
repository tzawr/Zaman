import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emailChangeMode } from './emailChange.js'

const user = (...providers) => ({ email: 'a@example.test', providerData: providers.map(providerId => ({ providerId })) })

test('a password account changes its email in HENGAM, also when Google is linked', () => {
  assert.equal(emailChangeMode(user('password')), 'hengam')
  assert.equal(emailChangeMode(user('google.com', 'password')), 'hengam')
  assert.equal(emailChangeMode(user('password', 'phone')), 'hengam')
})

test('a Google-only account (with or without a phone) is managed by Google', () => {
  assert.equal(emailChangeMode(user('google.com')), 'google')
  assert.equal(emailChangeMode(user('google.com', 'phone')), 'google')
})

test('no email sign-in, or no user, offers nothing to change', () => {
  assert.equal(emailChangeMode(user('phone')), 'none')
  assert.equal(emailChangeMode(user()), 'none')
  assert.equal(emailChangeMode(null), 'none')
})
