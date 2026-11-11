# Hengam load, reliability and journey tests

Everything here runs against the **local Firebase emulators** by default and
refuses production outright. Nothing in this directory can call a paid
provider: AI and push traffic goes to local sinks that only count requests.

```
loadtest/
  lib/guard.js            target safety, shared by the runner and every k6 script
  lib/guard.test.mjs      proves production is refused (npm run loadtest:guard-test)
  lib/sinks.mjs           local stand-ins for Anthropic and Expo push
  config/targets.json     staging allowlist (empty until staging exists)
  config/profiles.js      smoke → extreme, soak, spike
  config/thresholds.*.json pass/fail bounds (default, then baseline-derived)
  config/pricing.json     unit prices and per-action op estimates for cost
  data/seed.mjs           synthetic workplaces, managers, staff, availability, shifts
  k6/teams-api.js         weighted manager/employee workflows with think time
  k6/ratelimit.js         429 behaviour under concurrency
  k6/races.js             double-booking and lost-update races
  scripts/run.mjs         guarded runner: sinks, isolated API, seed, k6, integrity, report
  scripts/verify.mjs      reads Firestore back after a run
  scripts/report.mjs      Markdown report + cost estimate
  playwright/             user journeys and cross-tenant tests
  results/                run output (git-ignored)
```

## Safety model

`lib/guard.js` runs before any traffic, in the runner and again in each k6
script's init context, so calling `k6 run` by hand does not skip it.

- **Always refused:** `hengam.app` and subdomains, any `*.vercel.app` (preview
  deployments share production's Firebase project), `*.firebaseapp.com`,
  `*.web.app`, and the production Firebase project `zaman-ba689`. No
  allowlist entry or approval overrides this.
- **Allowed:** loopback, with a `demo-*` emulator project.
- **Staging:** only hosts and Firebase projects listed in
  `config/targets.json`.
- **Approval:** anything above smoke/baseline locally, or above smoke on
  staging, needs `LOADTEST_APPROVAL=<profile>:<host>:<YYYY-MM-DD>`. It names
  the profile, the host and the day, so it can't be reused.

The runner starts its own API (`scripts/dev-api.js`) with a **clean
environment**: no inherited `ANTHROPIC_API_KEY`, service-account or Expo
credentials. `ANTHROPIC_BASE_URL` and `EXPO_PUSH_URL` point at the sinks.
Each report prints how many calls the sinks caught.

## Running locally

Needs Java 21 for the emulators (`JAVA_HOME=/opt/homebrew/opt/openjdk@21`),
k6 (`brew install k6`) and Playwright's Chromium (`npx playwright install chromium`).

| Command | What it does | Approval |
|---|---|---|
| `npm run test:integration` | Rate limiter and AI budget through the real handlers | no |
| `npm run loadtest:guard-test` | Guard unit tests | no |
| `npm run loadtest:smoke` | 5 VUs, ~90 s, mixed workflows | no |
| `npm run loadtest:ratelimit` | concurrent bursts at a 10/hour limit | no |
| `npm run loadtest:races` | 25 simultaneous conflicting writes, twice | no |
| `npm run loadtest:baseline` | 25 → 50 VUs, ~9 min; saves baseline thresholds | no |
| `npm run test:e2e` | Playwright journeys and tenancy tests | no |

Each `loadtest:*` script starts the emulators, runs, and shuts them down.
Results land in `loadtest/results/<run>-report.md`, next to the raw k6 summary
JSON and the API log.

Heavier profiles locally, after agreeing to it:

```bash
LOADTEST_APPROVAL=moderate:local:$(date -u +%F) firebase emulators:exec --only auth,firestore --project demo-hengam 'node loadtest/scripts/run.mjs --profile moderate'
```

A laptop running the emulators is not a performance environment. Local runs
find **correctness** problems (limits, races, integrity, tenancy) and
**relative** regressions. Absolute latency and capacity numbers only mean
something on staging.

## Profiles

| Profile | Peak VUs | Shape | Purpose |
|---|---:|---|---|
| smoke | 5 | 15 s ramp, 1 min hold | does it work at all |
| baseline | 50 | 25 then 50, 3 min each | reference numbers for thresholds |
| moderate | 250 | 100 then 250 | first real load |
| high | 1,000 | 500 then 1,000 | pilot-plus headroom |
| extreme | 5,000 | 2,000 then 5,000 | only after high passes on staging |
| soak | 50 | 2 h hold | leaks, counter growth, cost drift |
| spike | 500 | 50 → 500 in 15 s → 50 | overload and recovery |

A VU is one simulated person with 3–12 s think time, not a request rate: one
VU makes roughly 0.1–0.3 requests a second. Throughput is read from
`http_reqs`, never inferred from VUs.

## Thresholds

`config/thresholds.default.json` holds sanity bounds only: no security
violations, no auth failures, no timeouts, under 1% unexpected responses, and
generous p95s. A clean baseline run (`npm run loadtest:baseline`) writes
`config/thresholds.baseline.json`: per action, p95 under 1.5× baseline and
p99 under 2×. Later runs are judged against that. Regenerate it per
environment; a laptop baseline means nothing on staging.

## What "passed" means

A run passes only when **all** of these hold:

1. k6 thresholds pass.
2. `scripts/verify.mjs` finds no P0 after reading Firestore back: no double
   bookings, no cross-tenant writes, no rate-limit counter over its limit.
   Write accounting (created − deleted = stored) and open AI holds are
   reported too.
3. The sinks caught 0 unexpected provider calls.

## Staging

A separate Firebase project and a separate, protected Vercel project, with no customer
data and paid AI and push disabled. The real identifiers live only in git-ignored files:
`loadtest/.data/staging.json` (web config, bypass secret, deployment URL, path to the
staging service-account key) and `loadtest/.data/targets.json` (the staging allowlist).
The committed `config/targets.json` is an empty template.

| Command | What it does |
|---|---|
| `node loadtest/staging/deploy.mjs [--rules]` | Deploys the **committed** tree as a protected preview from a temp copy linked only to the staging project. Refuses if the public domain serves anything. `--rules` also deploys rules and indexes to staging. |
| `node loadtest/data/seed.mjs --staging --tenants 6 --out loadtest/.data/staging-identities.json` | Adds tagged synthetic workplaces. Refuses any service account that isn't the allowlisted staging project. |
| `E2E_TARGET=staging npx playwright test -c loadtest/playwright/playwright.config.js` | Same tenancy, invitation and journey specs, against staging |
| `node loadtest/staging/run.mjs --profile smoke` | k6 mixed workflow, then an integrity read-back from staging |
| `node loadtest/staging/run.mjs --profile race --script races` | The four write races on real Firestore |
| `node loadtest/staging/run.mjs --profile ratelimit --script ratelimit` | 429 behaviour on the real platform |
| `node loadtest/staging/xff-probe.mjs` | Whether forged IP headers change a caller's rate-limit identity on Vercel |

Smoke, race and ratelimit (fixed, small workloads) run on staging without approval.
Baseline and above need `LOADTEST_APPROVAL=<profile>:<staging host>:<YYYY-MM-DD>`.

Reports, the release checklist and the contention write-up are kept out of the public
repository, in `loadtest/private/` (git-ignored).
