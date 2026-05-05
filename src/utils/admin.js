// Add your Firebase Auth UID here to unlock /admin/users and admin-only writes.
export const ADMIN_UIDS = [
  // 'YOUR_ADMIN_UID',
]

export function isAdminUid(uid) {
  return Boolean(uid && ADMIN_UIDS.includes(uid))
}
