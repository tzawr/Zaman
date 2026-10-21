// Builds Hengam Teams onto your own iPhone, signed with a free Apple
// account, talking to the emulators on this Mac over Wi-Fi.
//
//   node scripts/ios-device.js           build, install, then start the
//                                        bundler (first time, after native
//                                        changes, or every 7 days)
//   node scripts/ios-device.js start     just start the bundler for an app
//                                        that is already installed
//
// The native build runs in a copy outside this folder (HENGAM_IOS_BUILD_DIR,
// by default ~/Library/Developer/HengamTeams). When Desktop syncs to iCloud,
// every new folder in it gets Finder attributes that code signing refuses.
// The bundler still runs here, so edits reload on the phone as usual.
//
// Before either, from the repo root: npm run dev:emulators:device,
// npm run dev:api:device and npm run dev:seed. The phone and the Mac must be
// on the same Wi-Fi. See "Testing on your iPhone" in docs/TEAMS_ARCHITECTURE.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { homedir, networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '..')
const buildDir = process.env.HENGAM_IOS_BUILD_DIR || join(homedir(), 'Library', 'Developer', 'HengamTeams')

function lanAddress() {
  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addrs]) => (addrs || []).map(a => ({ name, ...a })))
    .filter(a => a.family === 'IPv4' && !a.internal)
  // Wi-Fi first: en0 on most Macs.
  return (candidates.find(a => a.name === 'en0') || candidates[0])?.address
}

// The free "Personal Team" Xcode signs with, unless APPLE_TEAM_ID says otherwise.
function personalTeam() {
  try {
    const teams = execFileSync('defaults', ['read', 'com.apple.dt.Xcode', 'IDEProvisioningTeamByIdentifier'], { encoding: 'utf8' })
    const blocks = teams.split('}')
    const personal = blocks.find(b => /isFreeProvisioningTeam = 1/.test(b))
    return personal?.match(/teamID = (\w+);/)?.[1]
  } catch {
    return undefined
  }
}

const host = lanAddress()
if (!host) {
  console.error('No network address found. Connect this Mac to Wi-Fi, the same network as the iPhone.')
  process.exit(1)
}
const team = process.env.APPLE_TEAM_ID || personalTeam()
if (!team) {
  console.error('No Apple team found. Sign in to Xcode → Settings → Accounts with your Apple ID, or set APPLE_TEAM_ID.')
  process.exit(1)
}

const env = {
  ...process.env,
  IOS_FREE_TEAM: '1',
  // ios/ is generated and ignored; prebuild need not stop to ask about git.
  EXPO_NO_GIT_STATUS: '1',
  APPLE_TEAM_ID: team,
  // These win over .env.local, which points at 127.0.0.1 for the web app.
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-hengam',
  EXPO_PUBLIC_USE_EMULATORS: '1',
  EXPO_PUBLIC_EMULATOR_HOST: host,
  EXPO_PUBLIC_API_URL: `http://${host}:3001`,
}
console.log(`Building for team ${team}; the app will use the emulators at ${host}.`)

const run = (command, args, cwd) => {
  const r = spawnSync(command, args, { stdio: 'inherit', env, cwd })
  if (r.status !== 0) process.exit(r.status || 1)
}

if (process.argv[2] !== 'start') {
  // The app imports from ../shared, so both go across, side by side.
  console.log(`Copying the app to ${buildDir} for the native build…`)
  run('mkdir', ['-p', buildDir])
  run('rsync', ['-a', '--delete', '--exclude', '/ios', '--exclude', '/.expo', '--exclude', '/dist',
    `${appDir}/`, join(buildDir, 'teams') + '/'])
  run('rsync', ['-a', '--delete', `${join(repoDir, 'shared')}/`, join(buildDir, 'shared') + '/'])
  const copy = join(buildDir, 'teams')
  // Regenerated each time, so the free-account settings always apply.
  run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], copy)
  run('npx', ['expo', 'run:ios', '--device', '--no-bundler', ...process.argv.slice(2)], copy)
}
// 8082, so it can run beside the web preview on 8081.
run('npx', ['expo', 'start', '--dev-client', '--port', '8082'], appDir)
