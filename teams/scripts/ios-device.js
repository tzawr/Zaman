// Builds Hengam Teams onto your own iPhone, signed with a free Apple account.
//
//   node scripts/ios-device.js live [device]  a self-contained app on the live
//                                             backend (hengam.app and the
//                                             production Firebase project).
//                                             Works anywhere, without this Mac.
//   node scripts/ios-device.js [device]       a development app against the
//                                             emulators on this Mac, then the
//                                             bundler, so edits reload live
//   node scripts/ios-device.js start          just the bundler, for a
//                                             development app already installed
//
// A free account's app stops opening after 7 days; build it again then.
//
// The native build runs in a copy outside this folder (HENGAM_IOS_BUILD_DIR,
// by default ~/Library/Developer/HengamTeams). When Desktop syncs to iCloud,
// every new folder in it gets Finder attributes that code signing refuses.
//
// The development app needs, from the repo root, npm run dev:emulators:device,
// npm run dev:api:device and npm run dev:seed, with the phone and the Mac on
// a network that lets them reach each other. See "Testing on your iPhone" in
// docs/TEAMS_ARCHITECTURE.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '..')
const buildDir = process.env.HENGAM_IOS_BUILD_DIR || join(homedir(), 'Library', 'Developer', 'HengamTeams')
const LIVE_API = 'https://hengam.app'

const args = process.argv.slice(2)
const mode = args[0] === 'live' || args[0] === 'start' ? args.shift() : 'dev'

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

// The UDID of the first physical iPhone Xcode sees.
function connectedIphone() {
  try {
    const out = execFileSync('xcrun', ['xctrace', 'list', 'devices'], { encoding: 'utf8' })
    const online = out.split('== Devices Offline ==')[0].split('== Simulators ==')[0]
    return online.split('\n').find(l => /iPhone/.test(l))?.match(/\(([0-9A-F-]{20,})\)\s*$/)?.[1]
  } catch {
    return undefined
  }
}

// The production Firebase web settings, from the ones Hengam's web app
// builds with (../.env.local). They are public by design; rules guard data.
function liveFirebase() {
  const vars = {}
  try {
    for (const line of readFileSync(join(repoDir, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^VITE_FIREBASE_([A-Z_]+)=(.*)$/)
      if (m) vars[`EXPO_PUBLIC_FIREBASE_${m[1]}`] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    // Reported below.
  }
  if (!vars.EXPO_PUBLIC_FIREBASE_API_KEY || !vars.EXPO_PUBLIC_FIREBASE_PROJECT_ID) {
    console.error('The production Firebase settings were not found. Run `vercel env pull .env.local` at the repo root.')
    process.exit(1)
  }
  return vars
}

const team = process.env.APPLE_TEAM_ID || personalTeam()
if (mode !== 'start' && !team) {
  console.error('No Apple team found. Sign in to Xcode → Settings → Accounts with your Apple ID, or set APPLE_TEAM_ID.')
  process.exit(1)
}

let backend
if (mode === 'live') {
  backend = {
    ...liveFirebase(),
    EXPO_PUBLIC_API_URL: LIVE_API,
    EXPO_PUBLIC_USE_EMULATORS: '',
    EXPO_PUBLIC_EMULATOR_HOST: '',
  }
  console.log(`Building a self-contained app on the live backend (${LIVE_API}, ${backend.EXPO_PUBLIC_FIREBASE_PROJECT_ID}).`)
} else {
  const host = lanAddress()
  if (!host) {
    console.error('No network address found. Connect this Mac to Wi-Fi, the same network as the iPhone.')
    process.exit(1)
  }
  backend = {
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-hengam',
    EXPO_PUBLIC_USE_EMULATORS: '1',
    EXPO_PUBLIC_EMULATOR_HOST: host,
    EXPO_PUBLIC_API_URL: `http://${host}:3001`,
  }
  console.log(`The app will use the emulators at ${host}.`)
}

const env = {
  ...process.env,
  IOS_FREE_TEAM: '1',
  // ios/ is generated and ignored; prebuild need not stop to ask about git.
  EXPO_NO_GIT_STATUS: '1',
  APPLE_TEAM_ID: team,
  // These win over .env.local, which points at the emulators for the web app.
  ...backend,
}

const run = (command, commandArgs, cwd) => {
  const r = spawnSync(command, commandArgs, { stdio: 'inherit', env, cwd })
  if (r.status !== 0) process.exit(r.status || 1)
}

if (mode !== 'start') {
  const device = args[0] || connectedIphone()
  if (!device) {
    console.error('No iPhone found. Connect it with a cable, unlock it, and trust this Mac.')
    process.exit(1)
  }
  // The app imports from ../shared, so both go across, side by side. The
  // copy leaves out .env.local, so only the settings above reach the build.
  console.log(`Copying the app to ${buildDir} for the native build…`)
  run('mkdir', ['-p', buildDir])
  run('rsync', ['-a', '--delete', '--exclude', '/ios', '--exclude', '/.expo', '--exclude', '/dist',
    '--exclude', '/.env.local', `${appDir}/`, join(buildDir, 'teams') + '/'])
  run('rsync', ['-a', '--delete', `${join(repoDir, 'shared')}/`, join(buildDir, 'shared') + '/'])
  const copy = join(buildDir, 'teams')
  // rsync leaves excluded files alone, so one copied by an older version of
  // this script would still be read.
  rmSync(join(copy, '.env.local'), { force: true })
  // Regenerated each time, so the free-account settings always apply.
  run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], copy)
  // Built with xcodebuild rather than expo run:ios, which does not let Xcode
  // create a profile for a free account or register the phone. Release
  // carries its own JavaScript, so it needs nothing from this Mac.
  const configuration = mode === 'live' ? 'Release' : 'Debug'
  const derived = join(copy, 'ios', 'build')
  run('xcodebuild', ['-workspace', 'ios/HengamTeams.xcworkspace', '-scheme', 'HengamTeams', '-configuration', configuration,
    '-destination', `id=${device}`, '-derivedDataPath', derived,
    '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', 'build'], copy)
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device,
    join(derived, 'Build', 'Products', `${configuration}-iphoneos`, 'HengamTeams.app')])
  console.log('Installed. Open Hengam Teams on the phone.')
}
if (mode !== 'live') {
  // 8082, so it can run beside the web preview on 8081.
  run('npx', ['expo', 'start', '--dev-client', '--port', '8082'], appDir)
}
