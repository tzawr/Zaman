import { readFileSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Journeys against the app running locally on the Firebase emulators:
//   npm run test:e2e        (starts the emulators, the API and the web app)
//
// The API is started with a fake Anthropic key and a provider URL that goes
// nowhere, so nothing in these tests can reach a paid service. The web app is
// `vite --mode emulators`, which connects to the emulators (.env.emulators).

for (const h of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST]) {
  if (h && !/^(127\.0\.0\.1|localhost):\d+$/.test(h)) throw new Error(`e2e: refusing non-loopback emulator ${h}`)
}

// E2E_TARGET=staging runs the same specs against the staging deployment in
// loadtest/.data/staging.json instead (helpers.js applies the guard).
const STAGING = process.env.E2E_TARGET === 'staging'
const staging = STAGING ? JSON.parse(readFileSync(new URL('../.data/staging.json', import.meta.url), 'utf8')) : null

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: STAGING ? 120_000 : 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../results/playwright-report' }]],
  outputDir: '../results/playwright-artifacts',
  use: {
    baseURL: STAGING ? staging.appUrl : 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: STAGING ? [] : [
    {
      command: 'node scripts/dev-api.js',
      cwd: '../..',
      url: 'http://127.0.0.1:3001/api/teams/health',
      reuseExistingServer: false,
      env: {
        PORT: '3001',
        GCLOUD_PROJECT: 'demo-hengam',
        ANTHROPIC_API_KEY: 'e2e-fake-key',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
        EXPO_PUSH_URL: 'http://127.0.0.1:9/push/send',
      },
      timeout: 30_000,
    },
    {
      command: 'npx vite --mode emulators --port 5175 --strictPort --host 127.0.0.1',
      cwd: '../..',
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: false,
      timeout: STAGING ? 120_000 : 60_000,
    },
  ],
})
