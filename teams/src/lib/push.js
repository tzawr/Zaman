// Push notifications on the web need a service worker and VAPID keys, which
// Hengam Teams does not have yet. In-app notifications work everywhere.
export const pushSupported = false

export async function pushStatus() {
  return 'unsupported'
}

export async function enablePush() {
  return { ok: false, reason: 'unsupported' }
}

export function usePushNavigation() {}
