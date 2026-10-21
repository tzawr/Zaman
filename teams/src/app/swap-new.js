import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { ApiError, callTeams } from '../lib/api'
import { closeModal } from '../lib/next'
import { useToday } from '../state/shifts'
import { formatDuration, formatShiftRange, relativeDay } from '../../../shared/teams/time'
import { Banner, Button, Card, EmptyState, Screen, SkeletonCard, Text, TextField } from '../ui/components'
import { useTheme } from '../ui/theme'

// Choose a coworker's shift to trade one of yours for. Each option says up
// front whether it fits your schedule; the other person's side is checked
// when you send the request.
export default function SwapNew() {
  const router = useRouter()
  const t = useTheme()
  const today = useToday()
  const params = useLocalSearchParams()
  const bizId = String(params.bizId)
  const myShiftId = String(params.shiftId)
  const [state, setState] = useState({ key: null, candidates: null, error: null })
  const [chosen, setChosen] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const key = `${bizId}/${myShiftId}`

  useEffect(() => {
    let live = true
    callTeams('listSwapCandidates', { bizId, myShiftId })
      .then(r => { if (live) setState({ key, candidates: r.candidates, error: null }) })
      .catch(err => { if (live) setState({ key, candidates: [], error: err instanceof ApiError ? err.message : 'Could not load shifts to swap with.' }) })
    return () => { live = false }
  }, [bizId, myShiftId, key])

  const current = state.key === key ? state : { candidates: null, error: null }

  async function send() {
    setBusy(true)
    setError(null)
    try {
      await callTeams('requestSwap', { bizId, myShiftId, theirShiftId: chosen.shiftId, note })
      closeModal(router)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the swap request.')
      setBusy(false)
    }
  }

  if (chosen) {
    return (
      <Screen>
        <Card>
          <Text variant="label" tone="muted">You’re asking {chosen.staffName} for</Text>
          <Text variant="heading">{relativeDay(chosen.date, today)} · {formatShiftRange(chosen)}</Text>
          <Text tone="muted">{formatDuration(chosen.minutes)}{chosen.positionName ? ` · ${chosen.positionName}` : ''}</Text>
        </Card>
        <Text tone="muted">{chosen.staffName} gets your shift in return. Nothing changes until they accept and, if your workplace requires it, a manager approves.</Text>
        <TextField label={`Note to ${chosen.staffName} (optional)`} value={note} onChangeText={setNote} />
        <Banner message={error} />
        <Button title="Send swap request" loading={busy} onPress={send} />
        <Button title="Choose a different shift" variant="ghost" onPress={() => { setChosen(null); setError(null) }} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Text tone="muted">Coworkers’ shifts in the next four weeks that aren’t already being traded.</Text>
      <Banner message={current.error} />
      {current.candidates === null ? <><SkeletonCard /><SkeletonCard /></> : current.candidates.length ? (
        current.candidates.map(c => (
          <Pressable key={c.shiftId} onPress={() => c.ok && setChosen(c)} disabled={!c.ok}
            accessibilityRole="button" accessibilityState={{ disabled: !c.ok }}
            accessibilityLabel={`${c.staffName}, ${relativeDay(c.date, today)}, ${formatShiftRange(c)}${c.ok ? '' : `. Not available: ${c.reason}`}`}
            style={({ pressed }) => ({ backgroundColor: pressed ? t.color.pressed : t.color.surface, borderRadius: t.radius.lg,
              borderWidth: 1, borderColor: t.color.border, padding: 14, gap: 4, opacity: c.ok ? 1 : 0.6 })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="label">{c.staffName}</Text>
              <Text variant="caption" tone="muted">{relativeDay(c.date, today)}</Text>
            </View>
            <Text variant="heading">{formatShiftRange(c)}</Text>
            <Text variant="caption" tone="muted">{formatDuration(c.minutes)}{c.positionName ? ` · ${c.positionName}` : ''}</Text>
            {!c.ok ? (
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                <Feather name="slash" size={14} color={t.color.danger} style={{ marginTop: 2 }} />
                <Text variant="caption" tone="danger" style={{ flex: 1 }}>{c.reason}</Text>
              </View>
            ) : null}
          </Pressable>
        ))
      ) : !current.error ? (
        <EmptyState icon="users" title="No shifts to swap with" message="None of your coworkers have upcoming shifts that are free to trade." />
      ) : null}
    </Screen>
  )
}
