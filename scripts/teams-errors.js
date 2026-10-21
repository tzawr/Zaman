import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin } from '../api/_firebase-admin.js'

// Lists the errors the server and the app recorded (api/_monitoring.js),
// grouped, most frequent first. Read-only.
//
//   node scripts/teams-errors.js            # the last 2 days
//   node scripts/teams-errors.js --days 7
//   node scripts/teams-errors.js --stack    # with the first stack lines

const daysArg = process.argv.indexOf('--days')
const days = daysArg > 0 ? Math.max(1, Number(process.argv[daysArg + 1]) || 2) : 2
const withStack = process.argv.includes('--stack')

initAdmin()
const db = getFirestore()

const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const snap = await db.collection('errorEvents').where('day', '>=', since).get()

// The same fingerprint on different days is one bug.
const groups = new Map()
for (const d of snap.docs) {
  const e = d.data()
  const g = groups.get(e.fingerprint) || { ...e, count: 0, days: new Set(), uids: new Set() }
  g.count += e.count || 0
  g.days.add(e.day)
  ;(e.uids || []).forEach(u => g.uids.add(u))
  if (e.lastSeen?.toMillis() > (g.lastSeen?.toMillis() || 0)) g.lastSeen = e.lastSeen
  groups.set(e.fingerprint, g)
}

if (!groups.size) {
  console.log(`No errors since ${since}.`)
  process.exit(0)
}
const sorted = [...groups.values()].sort((a, b) => b.count - a.count)
console.log(`${sorted.length} error groups since ${since}:\n`)
for (const g of sorted) {
  console.log(`${String(g.count).padStart(6)}×  [${g.source}] ${g.where}  —  ${g.message}`)
  console.log(`         ${g.uids.size} ${g.uids.size === 1 ? 'person' : 'people'}, last ${g.lastSeen?.toDate().toISOString()}, fingerprint ${g.fingerprint}`)
  if (g.context?.platform) console.log(`         ${g.context.platform} ${g.context.appVersion || ''}`)
  if (withStack && g.stack) console.log(g.stack.split('\n').slice(0, 6).map(l => `         ${l.trim()}`).join('\n'))
  console.log()
}
