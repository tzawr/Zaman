import { useRouter } from 'expo-router'
import { needsVerification, useAuth } from '../state/auth'
import { Card, Button, Text } from '../ui/components'

export default function VerifyEmailBanner() {
  const { user } = useAuth()
  const router = useRouter()
  if (!needsVerification(user)) return null
  return (
    <Card>
      <Text variant="label">Verify your email</Text>
      <Text tone="muted">We sent a link to {user.email}. You need to verify before you can create a workspace.</Text>
      <Button title="I have verified, or resend" variant="secondary" onPress={() => router.push('/verify-email')} />
    </Card>
  )
}
