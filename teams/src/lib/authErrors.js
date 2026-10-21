// Firebase error codes, in words a person can act on.
const MESSAGES = {
  'auth/invalid-email': 'That email address does not look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Use at least 8 characters for your password.',
  'auth/email-already-in-use': 'There is already an account with this email. Sign in instead.',
  'auth/invalid-credential': 'That email and password do not match.',
  'auth/wrong-password': 'That email and password do not match.',
  'auth/user-not-found': 'That email and password do not match.',
  'auth/user-disabled': 'This account has been disabled. Email hello@hengam.app.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Could not reach the server. Check your connection.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups and try again.',
  'auth/account-exists-with-different-credential':
    'This email is already registered with a different sign-in method. Use that one, then link this provider from Profile.',
}

// Closing the provider's own window is a choice, not an error.
export function isCancellation(err) {
  return ['auth/cancelled', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(err?.code)
}

export function authErrorMessage(err) {
  return MESSAGES[err?.code] || 'Something went wrong signing in. Try again.'
}
