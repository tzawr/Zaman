import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '../state/auth'
import { closeModal } from '../lib/next'
import { authErrorMessage } from '../lib/authErrors'
import { Banner, Button, Screen, Text } from '../ui/components'

export default function VerifyEmail() {
  const router = useRouter()
  const { user, refreshUser, resendVerification } = useAuth()
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(null)

  async function check() {
    setBusy('check')
    setNotice(null)
    try {
      const fresh = await refreshUser()
      if (fresh?.emailVerified) closeModal(router)
      else setNotice({ tone: 'warning', message: 'Not verified yet. Open the link in the email, then try again.' })
    } catch (err) {
      setNotice({ tone: 'danger', message: authErrorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  async function resend() {
    setBusy('resend')
    setNotice(null)
    try {
      await resendVerification()
      setNotice({ tone: 'success', message: `Sent a new link to ${user?.email}.` })
    } catch (err) {
      setNotice({ tone: 'danger', message: authErrorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen>
      <Text variant="heading">Check {user?.email}</Text>
      <Text tone="muted">
        Open the link we emailed you to confirm the address is yours. You can still join a workplace by invite in the meantime.
      </Text>
      <Banner tone={notice?.tone} message={notice?.message} />
      <Button title="I have verified" loading={busy === 'check'} disabled={Boolean(busy)} onPress={check} />
      <Button title="Send the link again" variant="secondary" loading={busy === 'resend'} disabled={Boolean(busy)} onPress={resend} />
    </Screen>
  )
}
