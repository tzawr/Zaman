// Sends real test emails through Resend with the STAGING key, only to an
// allowlist. Prints ids and outcomes, never the key.
//   node scripts/email-send-test.mjs <to> [<to> ...]
import { readFileSync } from 'node:fs'
import { sendEmail, welcomeEmail, inviteEmail, notificationEmail } from '../api/_email.js'
import { notificationText } from '../shared/notify/text.js'

const key = readFileSync('loadtest/.data/staging-secrets/RESEND_API_KEY', 'utf8').trim()
const cfg = JSON.parse(readFileSync('loadtest/.data/staging.json', 'utf8'))
const env = { RESEND_API_KEY: key, EMAIL_ALLOWED_RECIPIENTS: cfg.emailAllowlist || 'hello@hengam.app,@resend.dev', APP_ORIGIN: 'https://hengam.app' }
const origin = 'https://hengam.app'
const facts = { biz: 'Blue Door Café (TEST)', weekStart: '2026-11-16', count: 3 }
const sched = (lang) => { const t = notificationText('schedule_published', facts, lang); return notificationEmail({ lang, type: 'schedule_published', category: 'schedule', title: `[TEST] ${t.title}`, body: t.body, actionUrl: 'https://teams.hengam.app/calendar', origin }) }
const messages = [
  ['welcome-en', { ...welcomeEmail({ name: 'Test', origin, language: 'en' }), subject: '[TEST] Welcome to HENGAM' }],
  ['schedule-fa', sched('fa')],
  ['invite-en', { ...inviteEmail({ businessName: 'Blue Door Café (TEST)', employeeName: 'Test', link: `${origin}/invite/test-only`, language: 'en', origin }), subject: '[TEST] Invite' }],
]
for (const to of process.argv.slice(2)) {
  for (const [name, m] of messages) {
    try {
      const r = await sendEmail({ to, ...m, tag: `test_${name.replace(/-/g, '_')}` }, { env })
      console.log(`${name} -> ${to.replace(/^[^@]{3}/, '***')}: ${r.sent ? `sent ${r.id}` : `not sent (${r.reason})`}`)
    } catch (err) { console.log(`${name} -> ${to.replace(/^[^@]{3}/, '***')}: ERROR ${String(err.message).replace(/re_[A-Za-z0-9_]+/g, 're_[masked]')}`) }
  }
}
