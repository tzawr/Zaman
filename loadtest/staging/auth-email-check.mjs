// Live check on protected staging: HENGAM-branded verification and reset
// emails sent through Resend to Resend's test inbox. Prints outcomes only.
import { STAGING, api, signUp } from '../playwright/helpers.js'
if (!STAGING) throw new Error('run with E2E_TARGET=staging')
const tag = Date.now().toString(36)
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) process.exitCode = 1 }

const user = await signUp(`delivered+auth-${tag}@resend.dev`)
const v = await api('/api/teams/sendVerificationEmail', { token: user.idToken, body: { language: 'fa' } })
check('verification email sent by HENGAM (no fallback)', v.status === 200 && v.body?.sent === true, `${v.status} ${JSON.stringify(v.body)}`)
const r = await api('/api/teams/sendPasswordReset', { body: { email: user.email, language: 'en' } })
check('reset email sent by HENGAM (no fallback)', r.status === 200 && r.body?.ok === true && !r.body?.fallback, `${r.status} ${JSON.stringify(r.body)}`)
const n = await api('/api/teams/sendPasswordReset', { body: { email: `delivered+nobody-${tag}@resend.dev` } })
check('unknown address: identical answer', n.status === 200 && JSON.stringify(n.body) === JSON.stringify(r.body), JSON.stringify(n.body))
