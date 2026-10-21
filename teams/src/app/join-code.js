import { useState } from 'react'
import JoinInvite from '../components/JoinInvite'
import { normalizeInviteCode } from '../../../shared/teams/workspace'
import { Button, Screen, Text, TextField } from '../ui/components'

export default function JoinCode() {
  const [input, setInput] = useState('')
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')

  function lookUp() {
    const normalized = normalizeInviteCode(input)
    if (!normalized) {
      setError('Invite codes are 10 letters and numbers, like ABCDE-12345. You can paste the whole link too.')
      return
    }
    setError('')
    setCode(normalized)
  }

  if (code) return <Screen><JoinInvite code={code} onCancel={() => setCode(null)} /></Screen>

  return (
    <Screen>
      <Text tone="muted">Enter the code your manager sent, or paste the invite link.</Text>
      <TextField label="Invite code" value={input} onChangeText={setInput} placeholder="ABCDE-12345"
        autoCapitalize="characters" autoCorrect={false} autoFocus error={error}
        returnKeyType="go" onSubmitEditing={lookUp} />
      <Button title="Continue" onPress={lookUp} />
    </Screen>
  )
}
