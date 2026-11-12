// One place that turns Firebase Auth error codes into what a person reads on
// the sign-in, sign-up and reset pages (HQA-18). Every code someone can
// actually hit gets its own message; the generic one is a true last resort.

const MESSAGES = {
  'auth/invalid-email': 'authInvalidEmail',
  'auth/missing-email': 'authInvalidEmail',
  'auth/user-not-found': 'authUserNotFound',
  'auth/wrong-password': 'authInvalidCredential',
  'auth/invalid-credential': 'authInvalidCredential',
  'auth/invalid-login-credentials': 'authInvalidCredential',
  'auth/missing-password': 'authMissingPassword',
  'auth/email-already-in-use': 'authEmailInUse',
  'auth/weak-password': 'authWeakPassword',
  'auth/password-does-not-meet-requirements': 'authWeakPassword',
  'auth/too-many-requests': 'authTooMany',
  'auth/user-disabled': 'authUserDisabled',
  'auth/network-request-failed': 'authNetwork',
  'auth/popup-blocked': 'authPopupBlocked',
  'auth/unauthorized-domain': 'authGoogleUnavailable',
  'auth/operation-not-allowed': 'authGoogleUnavailable',
  'auth/operation-not-supported-in-this-environment': 'authGoogleUnavailable',
  'auth/web-storage-unsupported': 'authStorageBlocked',
  'auth/account-exists-with-different-credential': 'authDifferentSignIn',
  'auth/internal-error': 'authServiceDown',
}

// Closing the Google window, or clicking twice, is the person's choice.
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'])

/** The message to show for an auth error, or '' when nothing should be shown. */
export function authErrorMessage(code, t) {
  if (SILENT.has(code)) return ''
  const key = MESSAGES[code]
  return (key && t(key)) || t('authGeneric')
}

/** Codes that are the person's own input or choice: not reported to monitoring.
 *  Rate limits, blocked pop-ups and service failures are still reported. */
export const EXPECTED_AUTH_ERRORS = new Set([
  'auth/invalid-email', 'auth/missing-email', 'auth/user-not-found', 'auth/wrong-password',
  'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/missing-password',
  'auth/email-already-in-use', 'auth/weak-password', 'auth/password-does-not-meet-requirements',
  'auth/user-disabled', ...SILENT,
])

/** Every message key used above, so tests can check both languages have them. */
export const AUTH_MESSAGE_KEYS = [...new Set([...Object.values(MESSAGES), 'authGeneric'])]
