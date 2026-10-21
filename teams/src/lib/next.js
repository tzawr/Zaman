// Screens reached from an invite link pass ?next=/join/CODE through sign-in,
// so the person lands back on the invite. Only in-app paths are honoured.
export function safeNext(value) {
  const next = Array.isArray(value) ? value[0] : value
  return typeof next === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(next) && !next.startsWith('//') ? next : null
}

// Closes a modal. Opened from a link there is nothing behind it to go back to,
// so it goes Home instead of doing nothing.
export function closeModal(router) {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}
