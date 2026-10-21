import { adminAuth } from './_firebase-admin.js'
import { recordError } from './_monitoring.js'
import { TeamsError } from './_teams-http.js'
import { leaveAllForDeletion } from './_teams-workspaces.js'

// Erasing an account, for Hengam (api/delete-account.js) and Hengam Teams
// (the deleteAccount action). One account spans both, so either deletes all
// of it.
//
// It is done on the server rather than in the app for two reasons. A client
// loop that deletes a hundred documents and then loses its connection
// leaves an account half-erased with no record of how far it got. And the last
// step — removing the auth user itself — is not something a client can be
// trusted to reach, which would leave a sign-in with no data behind it.
//
// Everything the account owns, by collection and the field that owns it:
const OWNED_BY_USER_ID = ['employees', 'schedules']
const OWNED_BY_MANAGER_ID = ['invites']
// Keyed by uid rather than holding it in a field.
const KEYED_BY_UID = ['users', 'adminOverrides']

// aiUsage and rateLimits documents are keyed `<uid>_<period>`, but both also
// carry the owner in a field, so they are found by field rather than by
// picking apart document ids.
const OWNER_FIELD = { aiUsage: 'uid', rateLimits: 'key', calendarFeeds: 'uid', pushQueue: 'uid' }

// Firestore caps a batch at 500 writes.
const BATCH_SIZE = 400

// How recently the person must have proved who they are.
export const REAUTH_WINDOW_SECONDS = 5 * 60

async function deleteQueryInBatches(db, query) {
  let deleted = 0
  for (;;) {
    const snap = await query.limit(BATCH_SIZE).get()
    if (snap.empty) return deleted
    const batch = db.batch()
    snap.docs.forEach(doc => batch.delete(doc.ref))
    await batch.commit()
    deleted += snap.size
    if (snap.size < BATCH_SIZE) return deleted
  }
}

// Deleting an account is irreversible, so the app re-authenticates first and
// this checks that it actually happened. auth_time is when the user last
// proved who they are; a token minted from a session that has been sitting
// open for a week is not consent to erase it.
export async function deleteAccount({ db, uid, token, now, auth = adminAuth() }) {
  const authAgeSeconds = Math.floor(now.getTime() / 1000) - Number(token?.auth_time || 0)
  if (!Number.isFinite(authAgeSeconds) || authAgeSeconds > REAUTH_WINDOW_SECONDS) {
    throw new TeamsError(401, 'reauth_required', 'Confirm it is you to delete your account.')
  }

  // Teams first: it is the one step that can refuse, and it must refuse
  // before anything is gone.
  const teams = await leaveAllForDeletion({ db, uid, now })
  if (!teams.ok) {
    throw new TeamsError(409, 'sole_owner',
      `You are the only owner of ${teams.blocking.join(', ')}. Make someone else an owner in Hengam Teams first, or remove everyone else.`)
  }

  try {
    const removed = {}
    for (const collection of OWNED_BY_USER_ID) {
      removed[collection] = await deleteQueryInBatches(
        db, db.collection(collection).where('userId', '==', uid))
    }
    for (const collection of OWNED_BY_MANAGER_ID) {
      removed[collection] = await deleteQueryInBatches(
        db, db.collection(collection).where('managerId', '==', uid))
    }
    for (const [collection, field] of Object.entries(OWNER_FIELD)) {
      removed[collection] = await deleteQueryInBatches(
        db, db.collection(collection).where(field, '==', uid))
    }
    for (const collection of KEYED_BY_UID) {
      await db.collection(collection).doc(uid).delete()
    }
    // The user document's Teams subcollections (workplaces, notifications,
    // devices) and the cross-workplace busy index outlive a plain delete.
    await db.recursiveDelete(db.collection('users').doc(uid))
    await db.recursiveDelete(db.collection('userBusy').doc(uid))

    // Last, so a failure anywhere above leaves an account that can still sign
    // in and retry rather than a dangling sign-in with no data.
    await auth.deleteUser(uid)

    console.log('account deleted', uid, JSON.stringify(removed))
    return { ok: true }
  } catch (err) {
    console.error('Account deletion failed:', uid, err)
    await recordError(db, { source: 'server', where: 'deleteAccount', error: err, uid, now })
    throw new TeamsError(500, 'server_error',
      'We could not finish deleting your account. Nothing was lost — email us and we will do it by hand.')
  }
}
