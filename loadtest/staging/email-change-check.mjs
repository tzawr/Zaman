// Live check on protected staging (hengam-staging): changing the sign-in email
// through HENGAM's server, and Firebase's own "sign-in email was changed"
// recovery message to the OLD address. Prints outcomes only.
//
//   E2E_TARGET=staging node loadtest/staging/email-change-check.mjs start <oldEmail>
//     creates a test account with <oldEmail>, asks HENGAM to change it to a
//     Resend test inbox, then applies a Firebase-generated change code the same
//     way the /auth/action page does. Firebase then emails <oldEmail>.
//   E2E_TARGET=staging node loadtest/staging/email-change-check.mjs finish <uid> <oldEmail>
//     after the recover link has been opened: the account uses <oldEmail> again.
//   ... cleanup <uid>   deletes the staging test account.
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { STAGING, api, signUp } from '../playwright/helpers.js'
if (!STAGING) throw new Error('run with E2E_TARGET=staging')
const staging = JSON.parse(readFileSync(new URL('../.data/staging.json', import.meta.url), 'utf8'))
initializeApp({ credential: cert(JSON.parse(readFileSync(staging.serviceAccountPath, 'utf8'))), projectId: staging.projectId })
const auth = getAuth()
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) process.exitCode = 1 }
const [cmd, a, b] = process.argv.slice(2)
const tag = Date.now().toString(36)

if (cmd === 'start') {
  const user = await signUp(a, `stg-${tag}-pass`)
  console.log('uid', user.uid)
  const other = await signUp(`delivered+ec-taken-${tag}@resend.dev`)
  const newEmail = `delivered+ec-new-${tag}@resend.dev`
  const r = await api('/api/teams/requestEmailChange', { token: user.idToken, body: { newEmail, language: 'en' } })
  check('change email sent by HENGAM to the new address (no fallback)', r.status === 200 && r.body?.sent === true, `${r.status} ${JSON.stringify(r.body)}`)
  const taken = await api('/api/teams/requestEmailChange', { token: user.idToken, body: { newEmail: other.email } })
  check('address already in use: same answer', taken.status === 200 && JSON.stringify(taken.body) === JSON.stringify(r.body), JSON.stringify(taken.body))
  const same = await api('/api/teams/requestEmailChange', { token: user.idToken, body: { newEmail: user.email } })
  check('unchanged address refused', same.body?.reason === 'same_email', JSON.stringify(same.body))
  await auth.deleteUser(other.uid)
  check('nothing changes before the link is opened', (await auth.getUser(user.uid)).email === a.toLowerCase())
  // The same kind of code our server put in the email (Admin SDK), applied the
  // way /auth/action applies it (Firebase client = accounts:update).
  const link = await auth.generateVerifyAndChangeEmailLink(a, newEmail)
  const oobCode = new URL(link).searchParams.get('oobCode')
  const ap = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${staging.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode }) })
  check('change code applied', ap.status === 200, String(ap.status))
  check('account now uses the new address', (await auth.getUser(user.uid)).email === newEmail.toLowerCase())
  console.log('now wait for Firebase\'s "sign-in email was changed" message at the old address')
} else if (cmd === 'finish') {
  check('account uses the old address again', (await auth.getUser(a)).email === b.toLowerCase())
} else if (cmd === 'cleanup') {
  await auth.deleteUser(a); console.log('deleted staging test account')
}
