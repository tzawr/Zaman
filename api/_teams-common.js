import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { paths } from '../shared/teams/schema.js'
import { isActive, isManagerRole } from '../shared/teams/workspace.js'
import { forbidden, invalid, notFound } from './_teams-http.js'

// Pieces every Teams workflow uses.

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export function audit(tx, db, bizId, actorUid, action, details, now) {
  tx.set(db.collection(`businesses/${bizId}/auditLog`).doc(), {
    actorUid, action, ...details, at: Timestamp.fromDate(now),
  })
}

export function requireString(value, message) {
  if (typeof value !== 'string' || !value) throw invalid(message)
  return value
}

// Firestore ids reach these functions from the request body, so they are
// checked before being spliced into a path.
export function requireId(value, what) {
  const id = requireString(value, `Missing ${what}.`)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw invalid(`Invalid ${what}.`)
  return id
}

export async function readActor(tx, db, bizId, uid) {
  const snap = await tx.get(db.doc(paths.member(bizId, uid)))
  if (!snap.exists || !isActive(snap.data())) {
    throw notFound('That workspace does not exist, or you are not a member of it.')
  }
  return snap.data()
}

export async function countOwners(tx, db, bizId) {
  const snap = await tx.get(db.collection(`businesses/${bizId}/members`)
    .where('role', '==', 'owner').where('status', '==', 'active'))
  return snap.size
}

export async function readManager(tx, db, bizId, uid) {
  const actor = await readActor(tx, db, bizId, uid)
  if (!isManagerRole(actor.role)) throw forbidden('Only managers can change the schedule.')
  return actor
}
