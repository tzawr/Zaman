import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { callTeams } from './api'

// Sends crashes and unhandled errors to the server, which groups them in
// errorEvents (api/_monitoring.js). Text only: the message, the stack, and
// which screen it was on. Never personal data from the screen itself.

const MAX_REPORTS = 10
const sent = new Set()
let currentRoute = ''

export function setErrorRoute(route) {
  currentRoute = route || ''
}

export function reportError(error, { componentStack } = {}) {
  // Development errors stay in the console unless asked for.
  if (__DEV__ && process.env.EXPO_PUBLIC_REPORT_ERRORS !== '1') return
  const message = String(error?.message || error || 'Unknown error')
  // One report per distinct error per session, and a handful at most, so a
  // render loop cannot flood the server.
  if (sent.has(message) || sent.size >= MAX_REPORTS) return
  sent.add(message)
  callTeams('reportClientError', {
    message,
    stack: String(error?.stack || ''),
    componentStack: componentStack || '',
    route: currentRoute,
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version || '',
  }, { signedIn: false }).catch(() => {})
}

// Errors no component caught: a rejected promise nobody awaited, or a throw
// in an event handler.
let installed = false
export function installGlobalErrorHandlers() {
  if (installed) return
  installed = true
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return
    window.addEventListener('error', (e) => reportError(e.error || e.message))
    window.addEventListener('unhandledrejection', (e) => reportError(e.reason))
    return
  }
  const previous = globalThis.ErrorUtils?.getGlobalHandler?.()
  globalThis.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    reportError(error)
    previous?.(error, isFatal)
  })
}
