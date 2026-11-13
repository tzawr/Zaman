// Who controls an account's sign-in email, from its linked sign-in providers.
//
//   'hengam'  the account has a password: HENGAM can change its sign-in email
//             (after the password is re-entered). Other linked providers, such
//             as Google, keep working.
//   'google'  Google-only: the email is the Google Account's. HENGAM doesn't
//             change it; the person changes it with Google.
//   'none'    no email sign-in (for example phone only): nothing to change.

/** @param {{ email?: string|null, providerData?: Array<{ providerId: string }> } | null | undefined} user */
export function emailChangeMode(user) {
  const providers = (user?.providerData || []).map(p => p?.providerId)
  if (providers.includes('password')) return 'hengam'
  if (providers.includes('google.com')) return 'google'
  return 'none'
}
