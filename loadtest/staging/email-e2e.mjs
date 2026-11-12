// Live email check against protected staging (E2E_TARGET=staging):
// synthetic accounts on Resend's test inbox (delivered+...@resend.dev), real
// sends through the staging key, outcomes read back from staging Firestore.
// Prints statuses only; no keys, no tokens.
import { fs, signUp, verifyEmail, teams, whereEq, STAGING } from '../playwright/helpers.js'
if (!STAGING) throw new Error('run with E2E_TARGET=staging')

const tag = Date.now().toString(36)
const field = (d, k) => { const v = d.fields?.[k]; return v && Object.values(v)[0] }
const outbox = async (uid) => (await (await fs.adminQuery({ from: [{ collectionId: 'emailOutbox' }], where: whereEq('uid', uid) })).json()).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), status: field(x.document, 'status'), type: field(x.document, 'type'), reason: field(x.document, 'reason'), providerId: field(x.document, 'providerId') }))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) process.exitCode = 1 }

const owner = await verifyEmail(await signUp(`delivered+owner-${tag}@resend.dev`))
const ana = await verifyEmail(await signUp(`delivered+ana-${tag}@resend.dev`))
const outsider = await verifyEmail(await signUp(`e2e-outside-${tag}@example.test`))

// 1. A schedule published in Teams reaches Ana in-app and by email, once.
const biz = await teams('createBusiness', owner.idToken, { name: `Email Check ${tag}`, timezone: 'America/Los_Angeles', requestId: `req-email-${tag}` })
check('workspace created', biz.status === 200, String(biz.status))
const bizId = biz.body.bizId
const inv = await teams('createInvite', owner.idToken, { bizId, name: 'Ana', role: 'employee' })
await teams('acceptInvite', ana.idToken, { code: inv.body.code })
const inv2 = await teams('createInvite', owner.idToken, { bizId, name: 'Out', role: 'employee' })
await teams('acceptInvite', outsider.idToken, { code: inv2.body.code })
for (const [token, staffId] of [[owner.idToken, inv.body.staffId], [owner.idToken, inv2.body.staffId]]) {
  const s = await teams('saveShift', token, { bizId, staffId, date: '2026-11-17', start: '09:00', end: '13:00' })
  check('shift saved', s.status === 200, String(s.status))
}
const pub = await teams('publishSchedule', owner.idToken, { bizId, weekStart: '2026-11-16' })
check('schedule published', pub.status === 200, String(pub.status))
await sleep(4000)
const anaNotes = ((await (await fs.adminGet(`users/${ana.uid}/notifications`)).json()).documents || []).filter(d => field(d, 'type') === 'schedule_published')
check('Ana has the in-app notification', anaNotes.length === 1, `${anaNotes.length}`)
const anaMail = await outbox(ana.uid)
check('Ana’s email was sent through Resend', anaMail.length === 1 && anaMail[0].status === 'sent' && !!anaMail[0].providerId, JSON.stringify(anaMail.map(m => m.status)))
const outMail = await outbox(outsider.uid)
check('an address outside the allowlist is never mailed', outMail.length > 0 && outMail.every(m => m.status === 'dropped' && m.reason === 'not_allowed'), JSON.stringify(outMail.map(m => `${m.status}:${m.reason || ''}`)))

// 2. Publishing the same week again, unchanged, sends nothing new.
await teams('publishSchedule', owner.idToken, { bizId, weekStart: '2026-11-16' })
await sleep(3000)
check('no duplicate email on republish', (await outbox(ana.uid)).filter(m => m.status === 'sent').length === 1)

// 3. Welcome email: once, to the verified owner, after onboarding.
await fs.adminSet(`users/${owner.uid}`, { email: owner.email, onboarded: true, displayName: 'Email Check' })
const w1 = await teams('sendWelcome', owner.idToken, { language: 'fa' })
const w2 = await teams('sendWelcome', owner.idToken, { language: 'fa' })
check('welcome sent once', w1.body?.sent === true && w2.body?.sent === false, `${JSON.stringify(w1.body)} then ${JSON.stringify(w2.body)}`)
