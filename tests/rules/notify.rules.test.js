import { after, before, beforeEach, test } from 'node:test'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { createEnv, seed } from './helpers.js'

// The notification center and email system: each person sees only their own
// notifications, can only mark them read or clear them, owns their
// preferences, and nobody in a browser can touch the email machinery.

let env
before(async () => { env = await createEnv() })
after(async () => { await env.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await seed(env, {
    'users/ana': { email: 'ana@x.test', tier: 'free' },
    'users/ben': { email: 'ben@x.test' },
    'users/ana/notifications/n1': { type: 'invite_accepted', title: 'T', body: 'B', app: 'web', readAt: null },
    'emailOutbox/ana_n1': { uid: 'ana', status: 'pending' },
    'emailLog/l1': { type: 'welcome', status: 'sent' },
    'emailEvents/e1': { status: 'delivered' },
    'emailSuppressions/h1': { reason: 'bounced' },
  })
})

const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@x.test`, email_verified: true }).firestore()

test('a person reads, marks read and clears only their own notifications', async () => {
  const ana = as('ana')
  await assertSucceeds(getDoc(doc(ana, 'users/ana/notifications/n1')))
  await assertSucceeds(updateDoc(doc(ana, 'users/ana/notifications/n1'), { readAt: serverTimestamp() }))
  await assertFails(updateDoc(doc(ana, 'users/ana/notifications/n1'), { title: 'forged' }))
  await assertSucceeds(deleteDoc(doc(ana, 'users/ana/notifications/n1')))
  const ben = as('ben')
  await assertFails(getDocs(collection(ben, 'users/ana/notifications')))
  await assertFails(getDoc(doc(ben, 'users/ana/notifications/n1')))
})

test('nobody creates a notification from a browser, not even for themselves', async () => {
  await assertFails(setDoc(doc(as('ana'), 'users/ana/notifications/x'), { title: 'spoof', readAt: null }))
  await assertFails(setDoc(doc(as('ben'), 'users/ana/notifications/x'), { title: 'spoof', readAt: null }))
})

test('preferences belong to their owner', async () => {
  const prefs = { email: { schedule: false }, inApp: { schedule: true }, language: 'fa' }
  await assertSucceeds(setDoc(doc(as('ana'), 'users/ana'), { notificationPrefs: prefs }, { merge: true }))
  await assertFails(setDoc(doc(as('ben'), 'users/ana'), { notificationPrefs: prefs }, { merge: true }))
  // Turning notifications off cannot be used to sneak a plan change in.
  await assertFails(setDoc(doc(as('ana'), 'users/ana'), { notificationPrefs: prefs, tier: 'pro' }, { merge: true }))
})

test('the email outbox, log, events and suppression list are server-only', async () => {
  const ana = as('ana')
  for (const path of ['emailOutbox/ana_n1', 'emailLog/l1', 'emailEvents/e1', 'emailSuppressions/h1']) {
    await assertFails(getDoc(doc(ana, path)))
    await assertFails(setDoc(doc(ana, path), { status: 'sent' }))
    await assertFails(deleteDoc(doc(ana, path)))
  }
  await assertFails(getDocs(collection(ana, 'emailOutbox')))
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'emailSuppressions/h1')))
})
