import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { getCalendars } from 'expo-localization'
import { ApiError, callTeams } from '../lib/api'
import { needsVerification, useAuth } from '../state/auth'
import { useWorkspace } from '../state/workspace'
import { isValidTimezone, validateBusinessName, validatePersonName } from '../../../shared/teams/workspace'
import { Banner, Button, Screen, Text, TextField } from '../ui/components'

function deviceTimezone() {
  try {
    return getCalendars()[0]?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export default function CreateWorkspace() {
  const router = useRouter()
  const { user } = useAuth()
  const { setActive } = useWorkspace()
  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState(user?.displayName || '')
  const [timezone, setTimezone] = useState(deviceTimezone)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // One id for this form, so a retried or double-tapped submit makes one
  // workspace, not two.
  const requestId = useMemo(() => Crypto.randomUUID(), [])
  const unverified = needsVerification(user)

  async function submit() {
    setError('')
    const next = {}
    const biz = validateBusinessName(name)
    const person = validatePersonName(ownerName)
    if (!biz.ok) next.name = biz.message
    if (!person.ok) next.ownerName = person.message
    if (!isValidTimezone(timezone.trim())) next.timezone = 'Use a time zone like America/Toronto or Europe/London.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const { bizId } = await callTeams('createBusiness', {
        name: biz.value, ownerName: person.value, timezone: timezone.trim(), requestId,
      })
      setActive(bizId)
      router.replace('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the workspace.')
      setBusy(false)
    }
  }

  if (unverified) {
    return (
      <Screen>
        <Text variant="heading">Verify your email first</Text>
        <Text tone="muted">Creating a workspace needs a confirmed email address, so your team knows the invites are really from you.</Text>
        <Button title="Verify my email" onPress={() => router.replace('/verify-email')} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Text tone="muted">A workspace is your business in Hengam Teams. You can invite people as soon as it exists.</Text>
      <TextField label="Business name" value={name} onChangeText={setName} placeholder="Blue Door Cafe"
        error={errors.name} autoFocus returnKeyType="next" />
      <TextField label="Your name" value={ownerName} onChangeText={setOwnerName} autoComplete="name"
        error={errors.ownerName} hint="How your team will see you." />
      <TextField label="Time zone" value={timezone} onChangeText={setTimezone} autoCapitalize="none"
        autoCorrect={false} error={errors.timezone} hint="Shift times are shown in this time zone." />
      <Banner message={error} />
      <Button title="Create workspace" loading={busy} onPress={submit} />
    </Screen>
  )
}
