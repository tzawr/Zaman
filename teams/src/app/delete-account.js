import { useState } from 'react'
import { View } from 'react-native'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { ApiError, callTeams } from '../lib/api'
import { authErrorMessage, isCancellation } from '../lib/authErrors'
import { reauthenticate } from '../lib/socialSignIn'
import { useAuth } from '../state/auth'
import { Banner, Button, Card, Screen, Text, TextField } from '../ui/components'

// Deleting the account, here rather than only in Hengam, because the stores
// require it wherever an account can be made. One account spans both apps,
// so this deletes both. The server re-checks that the person proved who they
// are in the last five minutes.

const WHAT_GOES = [
  'Your sign-in, profile and notifications',
  'Your calendar feed link and the devices that get your alerts',
  'Workplaces where you are the only person',
  'Your Hengam account and everything in it, if you use Hengam',
]

export default function DeleteAccount() {
  const { user, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const providers = (user?.providerData || []).map(p => p.providerId)
  const usesPassword = providers.includes('password')
  const social = providers.find(p => p === 'google.com' || p === 'apple.com')

  async function confirmAndDelete() {
    setError('')
    if (usesPassword && !password) {
      setError('Enter your password to confirm.')
      return
    }
    setBusy(true)
    try {
      if (usesPassword) {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
      } else {
        await reauthenticate(social)
      }
      // A fresh token carries the new auth_time the server checks.
      await user.getIdToken(true)
      await callTeams('deleteAccount')
      // The account is gone, so the session already is; this clears it here.
      await signOut().catch(() => {})
    } catch (err) {
      setBusy(false)
      if (isCancellation(err)) return
      if (err instanceof ApiError) setError(err.message)
      else if (err?.code === 'auth/user-mismatch') setError('That is a different account. Confirm with the account you are signed in to.')
      else if (['auth/invalid-credential', 'auth/wrong-password'].includes(err?.code)) setError('That password is not right.')
      else setError(authErrorMessage(err))
    }
  }

  return (
    <Screen>
      <Text variant="heading" accessibilityRole="header">Delete your account</Text>
      <Text tone="muted">This can’t be undone. You leave every workplace. Each keeps its own records of you, such as your name, contact details and the shifts and time off on its schedule; ask them if you want those removed.</Text>
      <Card>
        <Text variant="label">What is deleted</Text>
        {WHAT_GOES.map(line => (
          <View key={line} style={{ flexDirection: 'row', gap: 8 }}>
            <Text tone="muted" aria-hidden>•</Text>
            <Text tone="muted" style={{ flex: 1 }}>{line}</Text>
          </View>
        ))}
      </Card>

      <Banner message={error} />

      {usesPassword ? (
        <TextField label="Your password" value={password} onChangeText={setPassword} secureTextEntry
          autoComplete="current-password" textContentType="password" returnKeyType="done"
          onSubmitEditing={confirmAndDelete} />
      ) : (
        <Text tone="muted">
          To confirm, sign in again with {social === 'apple.com' ? 'Apple' : 'Google'}.
        </Text>
      )}
      <Button title="Delete my account" variant="danger" icon="trash-2" loading={busy} onPress={confirmAndDelete}
        accessibilityHint="Deletes your account and all its data, after you confirm it is you" />
    </Screen>
  )
}
