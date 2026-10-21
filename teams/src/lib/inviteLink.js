import { Platform, Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { formatInviteCode } from '../../../shared/teams/workspace'

// Where an invite link opens: the Teams web app, which hands off to the app
// when it is installed.
const BASE = (process.env.EXPO_PUBLIC_INVITE_BASE_URL || 'https://teams.hengam.app').replace(/\/$/, '')

export function inviteLink(code) {
  return `${BASE}/join/${formatInviteCode(code)}`
}

export function inviteMessage({ code, businessName }) {
  return `You're invited to ${businessName} on Hengam Teams. Open ${inviteLink(code)} or enter code ${formatInviteCode(code)} in the app.`
}

export async function copyInvite(invite) {
  await Clipboard.setStringAsync(inviteLink(invite.code))
}

// The share sheet on phones; on the web, where it is often missing, a copy.
export async function shareInvite(invite) {
  if (Platform.OS === 'web' && !globalThis.navigator?.share) {
    await copyInvite(invite)
    return 'copied'
  }
  await Share.share({ message: inviteMessage(invite) })
  return 'shared'
}
