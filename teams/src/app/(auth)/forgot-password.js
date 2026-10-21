import { useState } from 'react'
import { View } from 'react-native'
import { authErrorMessage } from '../../lib/authErrors'
import { useAuth } from '../../state/auth'
import { Banner, Button, Screen, Text, TextField } from '../../ui/components'

export default function ForgotPassword() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit() {
    setError('')
    if (!email.trim()) { setError('Enter the email you signed up with.'); return }
    setBusy(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      // Whether an account exists is not something to confirm to whoever asks.
      if (err?.code === 'auth/user-not-found') setSent(true)
      else setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen contentStyle={{ gap: 20 }}>
      <View style={{ gap: 6 }}>
        <Text variant="title" accessibilityRole="header">Reset your password</Text>
        <Text tone="muted">We will email you a link to choose a new one.</Text>
      </View>
      {sent ? (
        <Banner tone="success" message={`If there is an account for ${email.trim()}, a reset link is on its way. Check your spam folder if it does not arrive.`} />
      ) : (
        <View style={{ gap: 14 }}>
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none"
            autoComplete="email" keyboardType="email-address" returnKeyType="go" onSubmitEditing={submit} />
          <Banner message={error} />
          <Button title="Send reset link" loading={busy} onPress={submit} />
        </View>
      )}
    </Screen>
  )
}
