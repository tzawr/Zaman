// Load profiles. A VU is one simulated person working through a weighted
// workflow with think time between steps; it is not a request rate. With the
// 3-12 s think times in k6/teams-api.js a VU makes roughly 0.1-0.3 requests
// per second, so 100 VUs is on the order of 10-30 req/s. Throughput is
// measured, never assumed: read http_reqs in the summary.
//
// Only smoke and baseline (and the targeted ratelimit/race checks) run
// locally without approval; see lib/guard.js.

const ramp = (peak, { up = '1m', hold = '3m', down = '30s' } = {}) => ({
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: up, target: peak },
    { duration: hold, target: peak },
    { duration: down, target: 0 },
  ],
  gracefulRampDown: '30s',
})

export const PROFILES = {
  smoke: { vus: 5, scenario: ramp(5, { up: '15s', hold: '1m', down: '10s' }) },
  baseline: { vus: 50, scenario: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '1m', target: 25 }, { duration: '3m', target: 25 },
    { duration: '1m', target: 50 }, { duration: '3m', target: 50 },
    { duration: '30s', target: 0 },
  ], gracefulRampDown: '30s' } },
  moderate: { vus: 250, scenario: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '2m', target: 100 }, { duration: '5m', target: 100 },
    { duration: '2m', target: 250 }, { duration: '5m', target: 250 },
    { duration: '1m', target: 0 },
  ], gracefulRampDown: '30s' } },
  high: { vus: 1000, scenario: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '3m', target: 500 }, { duration: '5m', target: 500 },
    { duration: '3m', target: 1000 }, { duration: '5m', target: 1000 },
    { duration: '2m', target: 0 },
  ], gracefulRampDown: '1m' } },
  // Only after high passes cleanly on staging.
  extreme: { vus: 5000, scenario: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '5m', target: 2000 }, { duration: '5m', target: 2000 },
    { duration: '5m', target: 5000 }, { duration: '5m', target: 5000 },
    { duration: '3m', target: 0 },
  ], gracefulRampDown: '1m' } },
  // Sustained baseline-level load, to find leaks, counter growth and cost drift.
  soak: { vus: 50, scenario: ramp(50, { up: '5m', hold: '2h', down: '2m' }) },
  // Baseline, a sudden 10x jump held briefly, then back: measures recovery.
  spike: { vus: 500, scenario: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '2m', target: 50 }, { duration: '3m', target: 50 },
    { duration: '15s', target: 500 }, { duration: '2m', target: 500 },
    { duration: '15s', target: 50 }, { duration: '5m', target: 50 },
    { duration: '30s', target: 0 },
  ], gracefulRampDown: '30s' } },
}
