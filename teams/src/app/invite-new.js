import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { ApiError, callTeams } from '../lib/api'
import { copyInvite, inviteLink, shareInvite } from '../lib/inviteLink'
import { useWorkspace } from '../state/workspace'
import { closeModal } from '../lib/next'
import { canInvite, formatInviteCode, validatePersonName } from '../../../shared/teams/workspace'
import { Banner, Button, Card, Screen, Segmented, Text, TextField } from '../ui/components'

export default function InviteNew() {
  const router = useRouter()
  const { activeId, active, member } = useWorkspace()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('employee')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)

  // Offer only the roles this person can hand out.
  const roles = useMemo(() => [
    { value: 'employee', label: 'Employee' },
    { value: 'manager', label: 'Manager' },
    { value: 'owner', label: 'Owner' },
  ].filter(r => canInvite(member, r.value)), [member])

  async function submit() {
    setError('')
    const next = {}
    const person = validatePersonName(name)
    if (!person.ok) next.name = person.message
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'That email address does not look right.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const result = await callTeams('createInvite', { bizId: activeId, name: person.value, email: email.trim(), role })
      setCreated({ ...result, staffName: person.value, businessName: active?.name })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invite.')
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Screen>
        <Card>
          <Text variant="caption" tone="muted">Invite for {created.staffName}</Text>
          <Text variant="title" selectable accessibilityLabel={`Code ${created.code.split('').join(' ')}`}>
            {formatInviteCode(created.code)}
          </Text>
          <Text tone="muted" selectable>{inviteLink(created.code)}</Text>
          <Text variant="caption" tone="faint">Works once, for 14 days. You can share it again from the Team tab.</Text>
        </Card>
        <Banner tone="success" message={copied ? 'Link copied.' : ''} />
        <Button title="Share invite" icon="share" onPress={async () => {
          try {
            if ((await shareInvite(created)) === 'copied') setCopied(true)
          } catch {
            // Dismissed.
          }
        }} />
        <Button title="Copy link" icon="copy" variant="secondary" onPress={async () => { await copyInvite(created); setCopied(true) }} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Invite another" variant="ghost" style={{ flex: 1 }} onPress={() => {
            setCreated(null); setName(''); setEmail(''); setCopied(false)
          }} />
          <Button title="Done" variant="ghost" style={{ flex: 1 }} onPress={() => closeModal(router)} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen>
      <Text tone="muted">You get a code and a link to send them. They join with their own account.</Text>
      <TextField label="Their name" value={name} onChangeText={setName} autoFocus error={errors.name}
        hint="As it should appear on the schedule." />
      <TextField label="Email (optional)" value={email} onChangeText={setEmail} autoCapitalize="none"
        keyboardType="email-address" error={errors.email} hint="Kept private to managers." />
      {roles.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text variant="label" tone="muted">Role</Text>
          <Segmented accessibilityLabel="Role" options={roles} value={role} onChange={setRole} />
        </View>
      ) : null}
      <Banner message={error} />
      <Button title="Create invite" loading={busy} onPress={submit} />
    </Screen>
  )
}
