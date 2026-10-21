import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { ApiError, callTeams } from '../lib/api'
import { useAuth } from '../state/auth'
import { useWorkspace } from '../state/workspace'
import { formatInviteCode, normalizeInviteCode } from '../../../shared/teams/workspace'
import { Banner, Button, Card, Skeleton, Text } from '../ui/components'

const ROLE_LABEL = { owner: 'an owner', manager: 'a manager', employee: 'a team member' }

// Shows what an invite is for, then joins. Before sign-in it offers to create
// an account or sign in, and brings the person back here afterwards.
export default function JoinInvite({ code: rawCode, onCancel }) {
  const router = useRouter()
  const { user } = useAuth()
  const { setActive } = useWorkspace()
  const code = normalizeInviteCode(rawCode || '')
  const [result, setResult] = useState({ code: null, preview: null, error: '' })
  const [joinError, setJoinError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) return undefined
    let live = true
    callTeams('previewInvite', { code }, { signedIn: false })
      .then(p => { if (live) setResult({ code, preview: p, error: '' }) })
      .catch(err => {
        if (live) setResult({ code, preview: null, error: err instanceof ApiError ? err.message : 'Could not open this invite.' })
      })
    return () => { live = false }
  }, [code])

  const current = result.code === code ? result : { preview: null, error: '' }
  const preview = current.preview
  const error = !code
    ? 'That invite link is incomplete. Ask for the code and enter it instead.'
    : joinError || current.error

  async function join() {
    setBusy(true)
    setJoinError('')
    try {
      const { bizId } = await callTeams('acceptInvite', { code })
      setActive(bizId)
      router.replace('/')
    } catch (err) {
      setJoinError(err instanceof ApiError ? err.message : 'Could not join this workplace.')
      setBusy(false)
    }
  }

  const next = `/join/${formatInviteCode(code)}`
  return (
    <View style={{ gap: 16 }}>
      {!preview && !error ? (
        <Card accessibilityLabel="Loading invite"><Skeleton width="60%" height={22} /><Skeleton width="80%" /></Card>
      ) : null}
      {preview ? (
        <Card>
          <Text variant="caption" tone="muted">You are invited to join</Text>
          <Text variant="title">{preview.businessName}</Text>
          <Text tone="muted">as {ROLE_LABEL[preview.role]}{preview.name ? `, listed as ${preview.name}` : ''}.</Text>
        </Card>
      ) : null}
      <Banner message={error} />
      {preview && user ? <Button title={`Join ${preview.businessName}`} loading={busy} onPress={join} /> : null}
      {preview && !user ? (
        <>
          <Button title="Create an account to join" onPress={() => router.push({ pathname: '/sign-up', params: { next } })} />
          <Button title="I already have an account" variant="secondary" onPress={() => router.push({ pathname: '/sign-in', params: { next } })} />
        </>
      ) : null}
      {onCancel ? <Button title="Use a different code" variant="ghost" onPress={onCancel} /> : null}
    </View>
  )
}
