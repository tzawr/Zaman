import { auth } from '../firebase'

// Calls a Hengam Teams workflow from Hengam. Same endpoint, same rules, same
// messages as the Teams app.
export async function callTeams(action, body = {}) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Sign in again to continue.')
  const resp = await fetch(`/api/teams/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}

export const TEAMS_APP_URL = import.meta.env.VITE_TEAMS_APP_URL || 'https://teams.hengam.app'
