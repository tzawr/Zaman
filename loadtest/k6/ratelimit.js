import { check } from 'k6'
import exec from 'k6/execution'
import { Counter, Rate, Trend } from 'k6/metrics'
import { IDENTITIES, PROFILE, RUN_ID, signIn, teams } from './lib/env.js'

// 429 behaviour under concurrency: each VU is a different person who sends
// LIMIT + EXTRA requests to createBusiness (10 an hour) as fast as it can.
// The body is invalid, so the action refuses with 400 and writes nothing;
// only the limiter can answer 429. Every person must get exactly LIMIT
// non-429 answers, and every 429 must carry Retry-After.

const LIMIT = 10
const EXTRA = Number(__ENV.EXTRA || 15)
const VUS = Math.min(Number(__ENV.VUS || 20), IDENTITIES.tenants.length)
if (PROFILE !== 'ratelimit') throw new Error('ratelimit.js runs with PROFILE=ratelimit')

export const options = {
  scenarios: { burst: { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '3m' } },
  thresholds: { limiter_leaks: ['count==0'], missing_retry_after: ['count==0'], unexpected_responses: ['rate==0'] },
}

const leaks = new Counter('limiter_leaks')
const missingRetryAfter = new Counter('missing_retry_after')
const unexpected = new Rate('unexpected_responses')
const limitedMs = new Trend('rate_limited_response_ms', true)

export default function () {
  const owner = IDENTITIES.tenants[exec.vu.idInTest - 1].owner
  const session = signIn(owner.email)
  let allowed = 0
  for (let i = 0; i < LIMIT + EXTRA; i++) {
    const res = teams('createBusiness', session.idToken, { name: '' }, { probe: 'ratelimit' })
    if (res.status === 429) {
      limitedMs.add(res.timings.duration)
      if (!(Number(res.headers['Retry-After']) > 0)) missingRetryAfter.add(1)
    } else {
      allowed++
      unexpected.add(res.status !== 400)
    }
  }
  check(allowed, { 'exactly the limit got through': n => n === LIMIT })
  if (allowed > LIMIT) leaks.add(allowed - LIMIT)
}

export function handleSummary(d) {
  const out = __ENV.SUMMARY_OUT || `../results/${RUN_ID}-ratelimit.json`
  return { [out]: JSON.stringify(d, null, 2), stdout: `\nsummary written to ${out}\n` }
}
