// Renders every HENGAM email, in English and Persian, to HTML files and
// phone/desktop screenshots, without sending anything.
//   node scripts/email-preview.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { inviteEmail, notificationEmail, welcomeEmail } from '../api/_email.js'
import { categoryOf } from '../shared/notify/prefs.js'
import { KNOWN_TYPES, notificationText } from '../shared/notify/text.js'

const out = resolve(process.argv[2] || 'loadtest/results/email-preview')
mkdirSync(out, { recursive: true })
const origin = 'https://hengam.app'
const facts = { biz: 'Blue Door Café', weekStart: '2026-11-16', count: 4, date: '2026-11-17', start: '09:00', end: '15:00', who: 'Ana Rivera', approved: true, until: '2026-12-31' }
const emails = []
for (const lang of ['en', 'fa']) {
  emails.push([`welcome-${lang}`, welcomeEmail({ name: 'Maya', origin, language: lang })])
  emails.push([`invite-${lang}`, inviteEmail({ businessName: 'Blue Door Café', employeeName: 'Ana', link: `${origin}/invite/0b6c1a7e-demo`, language: lang, origin })])
  for (const type of KNOWN_TYPES) {
    const t = notificationText(type, facts, lang)
    const app = ['invite_accepted', 'availability_changed', 'plan_activated', 'password_changed', 'account_deleted', 'welcome'].includes(type) ? 'web' : 'teams'
    emails.push([`${type}-${lang}`, notificationEmail({ lang, type, category: categoryOf(type), title: t.title, body: t.body, actionUrl: app === 'web' ? `${origin}/employees` : 'https://teams.hengam.app/calendar', origin })])
  }
}
const browser = await chromium.launch()
for (const [name, e] of emails) {
  // Preview uses the local logo; real emails link https://hengam.app/email-logo.png.
  const html = e.html.replaceAll(`${origin}/email-logo.png`, `file://${resolve('public/email-logo.png')}`)
  writeFileSync(join(out, `${name}.html`), html)
  writeFileSync(join(out, `${name}.txt`), `Subject: ${e.subject}\n\n${e.text}`)
}
for (const [name] of emails.filter(([n]) => /^(welcome|invite|schedule_published|password_changed)-/.test(n))) {
  for (const [w, h] of [[375, 900], [800, 900]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(`file://${join(out, `${name}.html`)}`)
    await page.screenshot({ path: join(out, `${name}-${w}.png`), fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (overflow) console.log(`OVERFLOW: ${name} at ${w}px`)
    await page.close()
  }
}
await browser.close()
console.log(`${emails.length} emails rendered to ${out}`)
