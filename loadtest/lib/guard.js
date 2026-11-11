// Target safety for every load-test entry point. Plain ES module with no k6 or
// Node imports, so the k6 scripts (in setup()) and the Node runner apply the
// exact same rules; running k6 by hand does not get around them.
//
// Rules:
//  1. Production is refused, always. No flag, allowlist entry or approval
//     overrides it. That covers hengam.app and every subdomain, every host of
//     the production Vercel project "zaman" (its previews share production's
//     Firebase project), *.firebaseapp.com / *.web.app, and the production
//     Firebase project id. Other *.vercel.app hosts are refused too unless
//     listed exactly in targets.json (the staging project's deployments).
//  2. Loopback (the emulators and scripts/dev-api.js) is allowed.
//  3. Anything else must be listed in loadtest/config/targets.json under
//     staging.hosts. Unlisted hosts are refused.
//  4. Profiles that generate significant traffic need an approval string
//     naming the profile, the host and today's date (UTC):
//         LOADTEST_APPROVAL=moderate:staging.example.com:2026-11-10
//     so an approval cannot be reused for another target, profile or day.

export const PRODUCTION_FIREBASE_PROJECTS = ['zaman-ba689']

const PRODUCTION_HOSTS = [
  /(^|\.)hengam\.app$/i,
  // The production Vercel project is "zaman": zaman.vercel.app,
  // zaman-<hash>-<team>.vercel.app, zaman-git-<branch>-<team>.vercel.app.
  /^zaman([-.][a-z0-9-]*)?\.vercel\.app$/i,
  /(^|\.)firebaseapp\.com$/i,
  /(^|\.)web\.app$/i,
]
// Shared hosting domains: never allowed by being "not production", only by
// an exact staging allowlist entry.
const SHARED_HOSTS = [/(^|\.)vercel\.app$/i]

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i

// Free to run without approval, by where they run.
const FREE_PROFILES = {
  local: ['smoke', 'baseline', 'ratelimit', 'race'],
  // race and ratelimit are fixed, bounded workloads (about 100 and 180
  // requests), not load: they check correctness on real Firestore.
  staging: ['smoke', 'race', 'ratelimit'],
}

function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/:?#]+|\[[^\]]+\])(?::\d+)?(?:[/?#]|$)/i)
  if (!m) throw new Error(`Load-test guard: "${url}" is not an http(s) URL.`)
  return m[1].toLowerCase()
}

/**
 * Throws unless the run is allowed. Returns { host, environment } otherwise.
 * @param {object} o
 * @param {string[]} o.urls          every base URL the run will send traffic to
 * @param {string} o.profile
 * @param {string} [o.projectId]     Firebase project the run reads and writes
 * @param {{ staging?: { hosts?: string[], firebaseProjects?: string[] } }} o.targets
 * @param {string} [o.approval]
 * @param {Date} [o.today]
 */
export function checkRun({ urls, profile, projectId, targets, approval = '', today = new Date() }) {
  if (!profile) throw new Error('Load-test guard: no profile given.')
  const stagingHosts = (targets?.staging?.hosts || []).map(h => String(h).toLowerCase())
  const stagingProjects = targets?.staging?.firebaseProjects || []

  if (projectId && PRODUCTION_FIREBASE_PROJECTS.includes(projectId)) {
    throw new Error(`Load-test guard: ${projectId} is the production Firebase project. Refused.`)
  }

  let environment = 'local'
  const hosts = []
  for (const url of urls.filter(Boolean)) {
    const host = hostOf(url)
    hosts.push(host)
    if (PRODUCTION_HOSTS.some(re => re.test(host)) && !LOOPBACK.test(host)) {
      throw new Error(`Load-test guard: ${host} is production (or shares production's data). Refused.`)
    }
    if (LOOPBACK.test(host)) continue
    if (SHARED_HOSTS.some(re => re.test(host)) && !stagingHosts.includes(host)) {
      throw new Error(`Load-test guard: ${host} is a shared Vercel host not listed in targets.json staging.hosts. Refused.`)
    }
    if (!stagingHosts.includes(host)) {
      throw new Error(`Load-test guard: ${host} is not in loadtest/config/targets.json staging.hosts. Refused.`)
    }
    environment = 'staging'
  }

  if (environment === 'local' && projectId && !projectId.startsWith('demo-')) {
    throw new Error(`Load-test guard: local runs use a demo-* emulator project, not ${projectId}.`)
  }
  if (environment === 'staging') {
    if (!projectId || !stagingProjects.includes(projectId)) {
      throw new Error(`Load-test guard: staging runs must name a Firebase project listed in targets.json staging.firebaseProjects (got ${projectId || 'none'}).`)
    }
  }

  if (!FREE_PROFILES[environment].includes(profile)) {
    const day = today.toISOString().slice(0, 10)
    const host = hosts.find(h => !LOOPBACK.test(h)) || 'local'
    const expected = `${profile}:${host}:${day}`
    if (approval !== expected) {
      throw new Error(
        `Load-test guard: profile "${profile}" on ${environment} needs explicit approval.\n` +
        `After agreeing the workload and cost, set LOADTEST_APPROVAL=${expected}`
      )
    }
  }
  return { environment, hosts }
}
