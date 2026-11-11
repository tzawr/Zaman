# Monitoring and alerting

## What is watched

| Signal | Source | Check in `/api/ops/status` | Warn | Critical |
|---|---|---|---|---|
| API reachable | `/api/teams/health` | (uptime check) | n/a | any non-200 |
| Firestore reachable and fast | `meta/health` read | `firestore` | > 2 s | no answer |
| Critical API errors | `errorEvents` (server, cron), recorded by every endpoint, the rate limiter and the AI budget | `server_errors` (last hour) | ≥ 1 | ≥ 10 |
| Scheduling failures | Browsers report `schedule.generate`, `schedule.rules.unavailable/unreadable` | `schedule_failures` (last hour) | ≥ 1 | ≥ 5 |
| Authentication issues | Browsers report **unexpected** sign-in/sign-up errors (`auth.signin`, `auth.signup`); wrong passwords etc. aren't reported | `auth_issues` (last hour) | ≥ 3 | ≥ 20 |
| AI calls | `aiUsage` day docs | `ai_calls_today` | ≥ 150 | ≥ 400 |
| AI spend | `aiUsage` month docs (Hengam + Teams) | `ai_spend_month` | ≥ $20 | ≥ $50 |
| One account near its cap | month docs vs cap ($5 Hengam, $1 Teams) | `ai_accounts_near_cap` | ≥ 80% | n/a |
| Requests dying mid-AI-call | `pendingUsd` held > 15 min | `ai_stuck_holds` | any | n/a |
| Daily job running | `meta/dailyJob` heartbeat | `daily_job` | > 26 h, never, or failed parts | n/a |

Thresholds are defaults in `api/_ops-status.js`. Override any of them per environment
with `OPS_<NAME>`, e.g. `OPS_AI_SPEND_MONTH_WARN_USD=10`.

Reports carry a fixed location label and an error code only: no names, emails, schedules
or rule text (checked by tests). Browser reports go through the existing rate-limited
`reportClientError` action.

## The status endpoint

`GET /api/ops/status` with `Authorization: Bearer <OPS_STATUS_TOKEN>`:
- **200** when the level is ok or warn; **503** when anything is critical;
- 401 for a wrong token; **404 when `OPS_STATUS_TOKEN` isn't set** (it doesn't exist).

Body: `{ level, checks: [{ name, level, detail }], version, at }`. Counts only. Each call
reads a few dozen documents.

## Alerting setup (needs approval; no code)

1. **Vercel env (production):**
   - `OPS_STATUS_TOKEN`: 32+ random characters, e.g. from `openssl rand -hex 24`.
   - `CRON_SECRET`: also 32+ random characters, so the daily job runs, prunes old error
     events and writes its heartbeat.
2. **Google Cloud Monitoring → Uptime checks** (project `zaman-ba689`, free up to 1M runs a month):
   - `hengam-health`: HTTPS `hengam.app` `/api/teams/health`, every 5 min, expect 200 and
     body contains `"ok":true`.
   - `hengam-ops`: HTTPS `hengam.app` `/api/ops/status`, **every 15 min**, custom header
     `Authorization: Bearer <OPS_STATUS_TOKEN>`. Each call reads ~30 documents; every
     15 minutes from 3 regions stays inside Firestore's free daily reads, every 5 minutes
     does not.
     - status 200 → alerts on **critical**;
     - plus a second check on body `"level":"ok"` → alerts on **warn** too (optional).
   - Alerting policy for each: uptime check failing from ≥ 2 regions for 5 min → email
     (and SMS if wanted). Alerting-policy pricing changed in 2026; one or two conditions
     cost cents, but verify on the pricing page.
3. **Budget alert** (Billing → Budgets, free): $10/month on the billing account, scoped to
   `zaman-ba689`, emails at 50 / 90 / 100%.
4. **Anthropic Console:** a monthly spend limit (e.g. $50) and usage notification emails.
   This caps AI spend even if application caps fail.
5. **Vercel:** usage notifications on (Settings → Billing).

## When an alert fires

| Check | First look | Likely action |
|---|---|---|
| `server_errors` | `node scripts/teams-errors.js` (errorEvents), Vercel logs | Roll back if it started with a release |
| `schedule_failures` | errorEvents where `schedule.*`; Firestore indexes READY? | Missing index, or a client-side bug: fix forward |
| `auth_issues` | errorEvents `auth.*` codes; Firebase Auth status; authorized domains | Config or provider outage |
| `ai_*` | `aiUsage` docs; Anthropic Console usage | Lower caps, block a key, rotate `ANTHROPIC_API_KEY` |
| `daily_job` | Vercel → Cron Jobs history | `CRON_SECRET` missing or job failing |
| `firestore` | Google Cloud status; Firestore console | Wait, or follow `BACKUP_AND_RECOVERY.md` |

## Verified on staging (2026-11-11, commit `0b35e7a`)

`node loadtest/staging/ops-check.mjs`: 32/32 checks passed.
- **Access:** 401 without a token, with a wrong token, with a same-length multi-byte token
  (this returned 500 before a fix) and with a token in the query string. 405 for POST. The
  deployment refuses requests without the Vercel bypass.
- **Healthy:** level ok, HTTP 200, after a real cron run wrote the heartbeat.
- **Real failure paths** (no paid calls; staging's AI provider address is unroutable):
  - provider failure → clean 500 with the budget hold released → `server_errors` warn;
  - 11 failures → critical, HTTP 503;
  - account at cap → 429 before any provider call → `ai_accounts_near_cap` warn.
- **Seeded totals:** monthly spend $52 → critical; 420 calls today → critical; a hold stuck
  for 40 min → warn.
- **Browser reports** through `reportClientError`: scheduling failures warn then critical;
  unexpected sign-in errors warn then critical. Playwright: a simulated Auth outage is
  reported as `auth.signin`, a wrong password is not, and no email is sent.
- **Daily job** silent for 30 h → warn; a cron run → ok.
- **Recovery:** every check returns to ok once the condition clears (errors older than an
  hour, synthetic usage removed).
- **Privacy:** no employee name, email, uid, rule text or key appeared in 19 status
  responses, and none in the stored error events.

Known limits:
- Browser reports share `reportClientError`'s limits (30 per address per hour; 2,400 per
  hour overall), so a burst from one office counts at most 30 an hour. That's enough to
  cross every threshold.
- A Firestore outage can't be simulated on staging; it's covered by unit tests of
  `evaluate()`.
- CLI deploys (staging) report version `local`; Git deploys report the commit.
