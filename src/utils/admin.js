// Add your Firebase Auth UID here to unlock /admin/users and admin-only writes.
export const ADMIN_UIDS = [
  'AjV7SA0tuzLOcizYBrbjH8Mo0fg1',
]

export function isAdminUid(uid) {
  return Boolean(uid && ADMIN_UIDS.includes(uid))
}
