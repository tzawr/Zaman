import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { initAdmin } from '../api/_firebase-admin.js'

// Until invites were claimed in the same batch that links the account, the
// claim write was denied by rules and swallowed, so every invite anyone ever
// accepted is still open. This closes each one against the account that
// actually used it. Safe to rerun: an invite already marked used is skipped.
//
//   node scripts/close-claimed-invites.js          # report only
//   node scripts/close-claimed-invites.js --apply  # write

const apply = process.argv.includes('--apply')

initAdmin()
const db = getFirestore()

const linked = await db.collection('users').where('accountType', '==', 'employee').get()

let closed = 0
let alreadyClosed = 0
let missing = 0
let conflicting = 0
let batch = db.batch()
let pending = 0

for (const userDoc of linked.docs) {
  const { inviteToken, managerId, linkedEmployeeId } = userDoc.data()
  if (typeof inviteToken !== 'string' || !inviteToken) continue

  const inviteRef = db.collection('invites').doc(inviteToken)
  const invite = await inviteRef.get()
  if (!invite.exists) { missing++; continue }

  const data = invite.data()
  if (data.used === true) { alreadyClosed++; continue }
  // An account whose link no longer matches the invite moved on to another
  // workspace; the invite is still closed, since someone did use it.
  if (data.managerId !== managerId || data.employeeId !== linkedEmployeeId) conflicting++

  closed++
  if (apply) {
    batch.update(inviteRef, { used: true, usedBy: userDoc.id, usedAt: FieldValue.serverTimestamp() })
    if (++pending === 400) {
      await batch.commit()
      batch = db.batch()
      pending = 0
    }
  }
}
if (apply && pending) await batch.commit()

console.log(`${apply ? 'Closed' : 'Would close'} ${closed} invites (${conflicting} no longer match their account's link).`)
console.log(`${alreadyClosed} already closed, ${missing} referenced invites no longer exist.`)
if (!apply) console.log('Rerun with --apply to write.')
