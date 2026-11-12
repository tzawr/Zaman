import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allows, categoryOf, languageFor, normalizePrefs, TYPE_CATEGORY } from './prefs.js'
import { KNOWN_TYPES, notificationText, weekText } from './text.js'
import { messages } from '../teams/notifications.js'

test('every type has a category, and every category but product is on by default', () => {
  for (const type of Object.keys(TYPE_CATEGORY)) assert.ok(categoryOf(type))
  assert.equal(allows(undefined, 'schedule_published', 'email'), true)
  assert.equal(allows(undefined, 'unknown_type', 'email'), false, 'unknown types count as product news, off by default')
})

test('switching a category off works per channel; security and account cannot be switched off', () => {
  const prefs = { email: { schedule: false, team: false, billing: false, reminders: false, requests: false, product: false } }
  assert.equal(allows(prefs, 'schedule_published', 'email'), false)
  assert.equal(allows(prefs, 'schedule_published', 'inApp'), true)
  assert.equal(allows(prefs, 'password_changed', 'email'), true)
  assert.equal(allows(prefs, 'account_deleted', 'email'), true)
  assert.equal(allows(prefs, 'welcome', 'email'), true)
})

test('stored preferences are normalized: unknown keys dropped, bad values replaced', () => {
  const n = normalizePrefs({ email: { schedule: 'yes', evil: true }, inApp: { team: false }, language: 'de' })
  assert.equal(n.email.schedule, true)
  assert.equal('evil' in n.email, false)
  assert.equal(n.inApp.team, false)
  assert.equal(n.language, null)
  assert.equal(languageFor({ notificationPrefs: { language: 'fa' } }), 'fa')
  assert.equal(languageFor({}), 'en')
})

test('every notification type has English and Persian text that is not empty', () => {
  const facts = { biz: 'Blue Door', weekStart: '2026-11-16', count: 3, date: '2026-11-17', start: '09:00', end: '13:00', who: 'Ana', approved: true, until: '2026-12-31' }
  for (const type of KNOWN_TYPES) {
    for (const lang of ['en', 'fa']) {
      const t = notificationText(type, facts, lang)
      assert.ok(t?.title?.length > 3, `${type} ${lang} title`)
      assert.equal(/undefined|null|NaN/.test(`${t.title} ${t.body}`), false, `${type} ${lang}: ${t.title} ${t.body}`)
    }
  }
  assert.match(notificationText('invite_accepted', { who: 'Ana' }, 'fa').title, /به تیم پیوست/)
})

test('every Teams message type is covered by both maps', () => {
  const sample = { bizId: 'b', businessName: 'B', weekStart: '2026-11-16', version: 1, shiftCount: 1, offerId: 'o', offeredByName: 'X', claimantUid: 'u', claimantName: 'Y', approved: true, swapId: 's', requesterName: 'R', counterpartyName: 'C', status: 'completed', forUid: 'u', role: 'claimant', give: { date: '2026-11-17', startLocal: '09:00', endLocal: '10:00' }, get: { date: '2026-11-18', startLocal: '09:00', endLocal: '10:00' }, shift: { id: 'x', version: 1, date: '2026-11-17', startLocal: '09:00', endLocal: '10:00', status: 'scheduled' }, request: { id: 'r', staffName: 'Z', startDate: '2026-11-17', endDate: '2026-11-17' }, today: '2026-11-16' }
  for (const [kind, build] of Object.entries(messages)) {
    const { type } = build(sample)
    assert.ok(TYPE_CATEGORY[type], `${kind} → ${type} needs a category`)
    assert.ok(KNOWN_TYPES.includes(type), `${kind} → ${type} needs text`)
  }
})

test('dates: weeks across a year boundary, Persian uses the site convention', () => {
  assert.equal(weekText('2026-12-28', 'en'), 'Dec 28 – Jan 3')
  assert.match(weekText('2026-11-16', 'fa'), /آبان/)
  assert.equal(weekText('not-a-date', 'en'), '')
})
