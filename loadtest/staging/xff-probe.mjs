// Can a caller choose their own rate-limit identity on Vercel by writing
// X-Forwarded-For (or x-real-ip, or x-vercel-forwarded-for) themselves?
//
//   node loadtest/staging/xff-probe.mjs
//
// From one machine (one real address), sends 31 signed-out previewInvite
// requests to staging, each claiming a different address in every IP header
// a client can write. previewInvite allows 30 per address per 15 minutes.
//   - 31st answered 429  -> the forged headers did not change who we are.
//   - all 31 allowed     -> identity is spoofable.
// Staging runs with LOG_CLIENT_IP_HEADERS=1, so the function logs (vercel
// logs) show exactly which header values reached the code, which also says
// whether the old first-entry X-Forwarded-For logic would have been fooled.
//
// Staging only: the URL comes from loadtest/.data/staging.json and passes the
// guard, which refuses production.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkRun } from '../lib/guard.js'
import { targetsPath } from '../lib/targets.mjs'

const root = resolve(import.meta.dirname, '..')
const cfg = JSON.parse(readFileSync(resolve(root, '.data/staging.json'), 'utf8'))
const targets = JSON.parse(readFileSync(targetsPath(root), 'utf8'))
checkRun({ urls: [cfg.appUrl], profile: 'smoke', projectId: cfg.projectId, targets })

const forged = (i) => ({
  'x-forwarded-for': `198.51.100.${i}`,
  'x-real-ip': `198.51.100.${i}`,
  'x-vercel-forwarded-for': `198.51.100.${i}`,
  forwarded: `for=198.51.100.${i}`,
})

const results = []
for (let i = 1; i <= 31; i++) {
  const r = await fetch(`${cfg.appUrl}/api/teams/previewInvite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vercel-protection-bypass': cfg.bypassSecret, ...forged(i) },
    body: JSON.stringify({ code: 'ABCDEFGHJK' }),
  })
  results.push(r.status)
}
const limitedAt = results.indexOf(429) + 1
console.log(`statuses: ${results.join(',')}`)
console.log(limitedAt
  ? `RESULT: limited at request ${limitedAt} despite a different forged address on every request -> identity NOT spoofable`
  : 'RESULT: all 31 allowed with rotating forged addresses -> identity IS spoofable')
// Limited before 31 (an earlier probe within 15 minutes) still means not spoofable.
process.exit(limitedAt ? 0 : 1)
