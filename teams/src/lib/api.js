import { auth } from './firebase'

// Calls a Teams workflow on the server. Every write in Teams goes through
// here; the server checks permissions inside a transaction and answers with
// a message written for the person using the app.

const BASE = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, { status = 0, reason = 'network' } = {}) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

export async function callTeams(action, body = {}, { signedIn = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (signedIn) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) throw new ApiError('Sign in to continue.', { status: 401, reason: 'auth_required' })
    headers.Authorization = `Bearer ${token}`
  }

  let resp
  try {
    resp = await fetch(`${BASE}/api/teams/${action}`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    throw new ApiError('Could not reach Hengam Teams. Check your connection and try again.')
  }

  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new ApiError(data.message || 'Something went wrong. Try again in a moment.', {
      status: resp.status,
      reason: data.reason || 'server_error',
    })
  }
  return data
}
