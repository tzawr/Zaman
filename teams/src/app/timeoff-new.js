import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, Switch, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import DateField from '../components/DateField'
import { ApiError, callTeams } from '../lib/api'
import { closeModal } from '../lib/next'
import { usePolicies } from '../state/availability'
import { useToday } from '../state/shifts'
import { useWorkspace } from '../state/workspace'
import { describeTimeOff, validateTimeOff } from '../../../shared/teams/availability'
import { normalizeTimeInput } from '../../../shared/teams/time'
import { Banner, Button, Card, Screen, SkeletonCard, Text, TextField } from '../ui/components'
import { useTheme } from '../ui/theme'

export default function TimeOffNew() {
  const router = useRouter()
  const t = useTheme()
  const today = useToday()
  const { activeId, active } = useWorkspace()
  const policies = usePolicies()
  const [category, setCategory] = useState(null)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [partial, setPartial] = useState(false)
  const [partialStart, setPartialStart] = useState('13:00')
  const [partialEnd, setPartialEnd] = useState('17:00')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // One id per form, so tapping twice or retrying sends one request.
  const requestId = useMemo(() => Crypto.randomUUID(), [])

  const chosen = category || policies?.categories[0]?.id
  const input = {
    category: chosen, startDate, endDate: partial ? startDate : endDate, reason,
    ...(partial ? { partialStart: normalizeTimeInput(partialStart) || partialStart, partialEnd: normalizeTimeInput(partialEnd) || partialEnd } : {}),
  }
  const check = policies ? validateTimeOff(input, { today, categories: policies.categories.map(c => c.id) }) : null

  async function submit() {
    setError('')
    if (!check?.ok) { setError(check?.message || 'Check the dates.'); return }
    setBusy(true)
    try {
      await callTeams('requestTimeOff', { bizId: activeId, requestId, ...input })
      closeModal(router)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request.')
      setBusy(false)
    }
  }

  if (!policies) return <Screen><SkeletonCard lines={3} /></Screen>
  return (
    <Screen>
      <Text tone="muted">Your manager at {active?.name || 'this workplace'} will approve or decline it.</Text>
      <View style={{ gap: 8 }}>
        <Text variant="label" tone="muted">Kind</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          {policies.categories.map(c => {
            const selected = c.id === chosen
            return (
              <Pressable key={c.id} onPress={() => setCategory(c.id)} accessibilityRole="radio" accessibilityState={{ selected }}
                accessibilityLabel={c.label}
                style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: 1.5,
                  borderColor: selected ? t.color.accent : t.color.border, backgroundColor: selected ? t.color.accentBg : t.color.surface }}>
                <Text variant="label" style={{ color: selected ? t.color.accent : t.color.text }}>{c.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <DateField label={partial ? 'Day' : 'First day'} value={startDate} min={today}
        onChange={(d) => { setStartDate(d); if (endDate < d) setEndDate(d) }} />
      {!partial ? <DateField label="Last day" value={endDate} min={startDate} onChange={setEndDate} /> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text>Part of the day only</Text>
        <Switch value={partial} onValueChange={setPartial} accessibilityLabel="Part of the day only" trackColor={{ true: t.color.accent }} />
      </View>
      {partial ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextField style={{ flex: 1 }} label="From" value={partialStart} onChangeText={setPartialStart} autoCapitalize="none" />
          <TextField style={{ flex: 1 }} label="To" value={partialEnd} onChangeText={setPartialEnd} autoCapitalize="none" />
        </View>
      ) : null}

      <TextField label="Reason (optional)" value={reason} onChangeText={setReason} multiline placeholder="Only your managers see this" />
      {check?.ok ? <Card><Text tone="muted">{describeTimeOff(check.value)}</Text></Card> : null}
      <Banner message={error} />
      <Button title="Send request" loading={busy} onPress={submit} />
    </Screen>
  )
}
