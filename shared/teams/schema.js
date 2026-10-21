// The Hengam Teams data model, as code. Server endpoints, the Teams app and the
// rules tests all read collection names, roles and status machines from here,
// so a status the server writes is one the client knows how to show and the
// rules know how to gate. docs/TEAMS_ARCHITECTURE.md explains the why.
//
// Everything a business owns lives under businesses/{bizId}. Isolation comes
// from that path plus a membership check in firestore.rules, so a forgotten
// filter in one query cannot reach another business.

export const BUSINESS_MODES = ['hengam', 'standalone']

// owner and manager share every permission except that only an owner can
// remove another owner or delete the business.
export const ROLES = ['owner', 'manager', 'employee']
export const MANAGER_ROLES = ['owner', 'manager']

export const MEMBER_STATUSES = ['active', 'removed']

export const SCHEDULE_SOURCES = ['hengam', 'manual', 'csv', 'xlsx', 'pdf', 'image']

// A status machine per workflow: each key lists the statuses it may move to.
// A status with no outgoing moves is final. Every server write that changes a
// status goes through canTransition, inside the same transaction that reads
// the current one.
export const TRANSITIONS = {
  schedule: {
    draft: ['published', 'archived'],
    published: ['archived'],
    archived: [],
  },
  // A shift stays with its original assignee through every offer and swap
  // state; only an approved transfer moves it, and that is a write to
  // assigneeUid and staffId, not a status.
  shift: {
    scheduled: ['cancelled'],
    cancelled: [],
  },
  offer: {
    available: ['pending', 'cancelled', 'expired'],
    // pending: a claim is waiting on the manager. Rejecting that claim puts
    // the offer back on the market.
    pending: ['available', 'approved', 'cancelled', 'expired'],
    approved: ['completed'],
    completed: [],
    cancelled: [],
    expired: [],
  },
  claim: {
    pending: ['approved', 'rejected', 'withdrawn', 'superseded'],
    approved: [],
    rejected: [],
    withdrawn: [],
    // Another claim on the same offer was approved.
    superseded: [],
  },
  swap: {
    pending_peer: ['pending_manager', 'approved', 'declined', 'cancelled', 'expired'],
    pending_manager: ['approved', 'rejected', 'cancelled', 'expired'],
    approved: ['completed'],
    completed: [],
    declined: [],
    rejected: [],
    cancelled: [],
    expired: [],
  },
  timeOff: {
    pending: ['approved', 'rejected', 'cancelled'],
    // An approved request can still be withdrawn before it starts.
    approved: ['cancelled'],
    rejected: [],
    cancelled: [],
  },
  invite: {
    open: ['accepted', 'revoked'],
    accepted: [],
    revoked: [],
  },
  importJob: {
    extracting: ['review', 'failed'],
    review: ['published', 'discarded'],
    published: [],
    failed: [],
    discarded: [],
  },
}

export function statusesOf(machine) {
  const table = TRANSITIONS[machine]
  if (!table) throw new Error(`Unknown status machine: ${machine}`)
  return Object.keys(table)
}

export function initialStatus(machine) {
  return statusesOf(machine)[0]
}

export function isFinal(machine, status) {
  const next = TRANSITIONS[machine]?.[status]
  return Array.isArray(next) && next.length === 0
}

export function canTransition(machine, from, to) {
  const next = TRANSITIONS[machine]?.[from]
  return Array.isArray(next) && next.includes(to)
}

// Built-in time-off categories. A business can add its own in settings; these
// ids are reserved so imports and Hengam sync can rely on them.
export const TIME_OFF_CATEGORIES = ['vacation', 'sick', 'personal', 'unpaid']

export const NOTIFICATION_TYPES = [
  'schedule_published',
  'schedule_changed',
  'marketplace_shift',
  'pickup_requested',
  'pickup_decided',
  'swap_requested',
  'swap_decided',
  'time_off_requested',
  'time_off_decided',
  'shift_reminder',
]

// Business-wide policy defaults, stored at businesses/{bizId}/settings/policies.
// Labor limits are whatever the business configures: the app does not know
// the law where the business operates, and says so in the settings screen.
export const DEFAULT_POLICIES = Object.freeze({
  pickupRequiresApproval: true,
  swapRequiresApproval: true,
  employeeFullView: false,
  employeesCanSubmitAvailability: true,
  maxHoursPerWeek: null,
  maxHoursPerDay: null,
  minRestHours: null,
  requirePositionMatch: true,
  requireLocationMatch: false,
  offerCutoffHours: 2,
  timeOffCategories: TIME_OFF_CATEGORIES,
  // Categories a business adds: [{ id, label }]. Their ids are also listed in
  // timeOffCategories when switched on.
  customTimeOffCategories: [],
})

// Paths. Collection names appear nowhere else, so a rename is one edit here
// and one in firestore.rules.
export const paths = {
  business: (bizId) => `businesses/${bizId}`,
  member: (bizId, uid) => `businesses/${bizId}/members/${uid}`,
  staff: (bizId, staffId) => `businesses/${bizId}/staff/${staffId}`,
  staffPrivate: (bizId, staffId) => `businesses/${bizId}/staffPrivate/${staffId}`,
  location: (bizId, id) => `businesses/${bizId}/locations/${id}`,
  position: (bizId, id) => `businesses/${bizId}/positions/${id}`,
  policies: (bizId) => `businesses/${bizId}/settings/policies`,
  schedule: (bizId, id) => `businesses/${bizId}/schedules/${id}`,
  shift: (bizId, id) => `businesses/${bizId}/shifts/${id}`,
  offer: (bizId, id) => `businesses/${bizId}/offers/${id}`,
  // Document id is the claimant's uid: one claim per person per offer, by
  // construction rather than by a check that could race.
  claim: (bizId, offerId, uid) => `businesses/${bizId}/offers/${offerId}/claims/${uid}`,
  swap: (bizId, id) => `businesses/${bizId}/swaps/${id}`,
  availability: (bizId, staffId) => `businesses/${bizId}/availability/${staffId}`,
  availabilityOverride: (bizId, staffId, id) => `businesses/${bizId}/availability/${staffId}/overrides/${id}`,
  timeOff: (bizId, id) => `businesses/${bizId}/timeOff/${id}`,
  importJob: (bizId, id) => `businesses/${bizId}/imports/${id}`,
  // Pending invites, for the manager's list. The code itself is never stored.
  invite: (bizId, id) => `businesses/${bizId}/invites/${id}`,
  audit: (bizId, id) => `businesses/${bizId}/auditLog/${id}`,
  syncState: (bizId, id) => `businesses/${bizId}/sync/${id}`,
  workplace: (uid, bizId) => `users/${uid}/workplaces/${bizId}`,
  // Document id is the dedupe key, so delivering the same event twice writes
  // the same document twice instead of two notifications.
  notification: (uid, key) => `users/${uid}/notifications/${key}`,
  device: (uid, id) => `users/${uid}/devices/${id}`,
  // Server-only. Start and end of every shift a person holds anywhere, with no
  // business details, for cross-workplace conflict checks.
  busyBlock: (uid, blockId) => `userBusy/${uid}/blocks/${blockId}`,
  // Server-only. Keyed by the SHA-256 of an invite code, pointing at the
  // business and invite it opens, so redeeming a code is one direct read.
  inviteCode: (codeHash) => `inviteCodes/${codeHash}`,
  // Server-only. The token is the secret in a calendar subscription URL.
  calendarFeed: (token) => `calendarFeeds/${token}`,
}

// Fields a signed-in user may change on their own notification. Everything
// else about a notification is written by the server.
export const NOTIFICATION_CLIENT_FIELDS = ['readAt']

// Fields a client may write on its own device registration.
export const DEVICE_FIELDS = ['platform', 'token', 'createdAt', 'updatedAt']
export const DEVICE_PLATFORMS = ['ios', 'android', 'web']
