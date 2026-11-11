import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRun } from './guard.js'

const local = ['http://127.0.0.1:3101', 'http://127.0.0.1:9099', 'http://127.0.0.1:8085']
const targets = { staging: { hosts: ['staging-api.example.test'], firebaseProjects: ['hengam-staging'] } }
const today = new Date('2026-11-10T12:00:00Z')
const run = (o) => checkRun({ urls: local, profile: 'smoke', projectId: 'demo-hengam', targets, today, ...o })

test('production is refused whatever the allowlist or approval says', () => {
  for (const url of ['https://hengam.app', 'https://www.hengam.app', 'https://teams.hengam.app', 'https://zaman.vercel.app', 'https://zaman-git-main-x.vercel.app', 'https://zaman-ba689.firebaseapp.com']) {
    const host = new URL(url).hostname
    assert.throws(() => run({
      urls: [url], profile: 'smoke', projectId: 'hengam-staging',
      targets: { staging: { hosts: [host], firebaseProjects: ['hengam-staging'] } },
      approval: `smoke:${host}:2026-11-10`,
    }), /production|Refused/, url)
  }
})

test('the production Firebase project is refused even from localhost', () => {
  assert.throws(() => run({ projectId: 'zaman-ba689' }), /production Firebase project/)
})

test('local runs need a demo- project', () => {
  assert.throws(() => run({ projectId: 'hengam-staging' }), /demo-/)
  assert.equal(run({}).environment, 'local')
})

test('unlisted hosts are refused', () => {
  assert.throws(() => run({ urls: ['https://api.someone-else.test'], projectId: 'hengam-staging' }), /not in loadtest\/config\/targets.json/)
})

test('smoke and baseline run locally without approval; heavier profiles need it', () => {
  assert.doesNotThrow(() => run({ profile: 'baseline' }))
  for (const profile of ['moderate', 'high', 'extreme', 'soak', 'spike']) {
    assert.throws(() => run({ profile }), /needs explicit approval/, profile)
    assert.doesNotThrow(() => run({ profile, approval: `${profile}:local:2026-11-10` }))
  }
})

test('staging: smoke is free, everything else needs an approval for that host, profile and day', () => {
  const urls = ['https://staging-api.example.test']
  assert.equal(run({ urls, projectId: 'hengam-staging' }).environment, 'staging')
  for (const fixed of ['race', 'ratelimit']) assert.doesNotThrow(() => run({ urls, projectId: 'hengam-staging', profile: fixed }))
  assert.throws(() => run({ urls, projectId: 'hengam-staging', profile: 'baseline' }), /baseline:staging-api.example.test:2026-11-10/)
  assert.throws(() => run({ urls, projectId: 'hengam-staging', profile: 'baseline', approval: 'baseline:staging-api.example.test:2026-11-09' }), /approval/)
  assert.throws(() => run({ urls, projectId: 'hengam-staging', profile: 'high', approval: 'baseline:staging-api.example.test:2026-11-10' }), /approval/)
  assert.doesNotThrow(() => run({ urls, projectId: 'hengam-staging', profile: 'baseline', approval: 'baseline:staging-api.example.test:2026-11-10' }))
})

test('staging must name an allowlisted Firebase project', () => {
  assert.throws(() => run({ urls: ['https://staging-api.example.test'], projectId: 'some-other' }), /firebaseProjects/)
})

test('the staging Vercel project is allowed only when listed exactly; production Vercel hosts never', () => {
  const host = 'hengam-staging-abc123-team.vercel.app'
  const t = { staging: { hosts: [host], firebaseProjects: ['hengam-staging'] } }
  assert.equal(run({ urls: [`https://${host}`], projectId: 'hengam-staging', targets: t }).environment, 'staging')
  assert.throws(() => run({ urls: ['https://hengam-staging-other-team.vercel.app'], projectId: 'hengam-staging', targets: t }), /not listed/)
  for (const prod of ['zaman.vercel.app', 'zaman-abc123-team.vercel.app', 'zaman-git-main-team.vercel.app']) {
    assert.throws(() => run({ urls: [`https://${prod}`], projectId: 'hengam-staging', targets: { staging: { hosts: [prod], firebaseProjects: ['hengam-staging'] } } }), /production/, prod)
  }
})
