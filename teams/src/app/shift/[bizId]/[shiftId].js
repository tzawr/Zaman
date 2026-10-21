import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Linking, Platform, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { doc, onSnapshot } from 'firebase/firestore'
import { ApiError, callTeams } from '../../../lib/api'
import { db } from '../../../lib/firebase'
import { useAuth } from '../../../state/auth'
import { useNow } from '../../../state/shifts'
import { useWorkspace } from '../../../state/workspace'
import { formatDateLong, formatDuration, formatShiftRange } from '../../../../../shared/teams/time'
import { buildCalendar, googleCalendarLink, shiftEvent } from '../../../../../shared/teams/ics'
import { Badge, Banner, Button, Card, Divider, Screen, SkeletonCard, Text, TextField } from '../../../ui/components'
import { useTheme } from '../../../ui/theme'

export default function ShiftDetail() {
  const params = useLocalSearchParams()
  const bizId = String(params.bizId)
  const shiftId = String(params.shiftId)
  const { workplaces, setActive } = useWorkspace()
  const workplace = workplaces?.find(w => w.id === bizId)
  const [state, setState] = useState({ key: null, shift: undefined })
  const key = `${bizId}/${shiftId}`

  useEffect(() => onSnapshot(doc(db, 'businesses', bizId, 'shifts', shiftId),
    (snap) => setState({ key, shift: snap.exists() ? snap.data() : null }),
    () => setState({ key, shift: null })), [bizId, shiftId, key])

  const shift = state.key === key ? state.shift : undefined
  if (shift === undefined) return <Screen><SkeletonCard lines={3} /></Screen>
  if (!shift) return <Screen><Banner tone="info" message="This shift is no longer on the schedule, or you no longer have access to it." /></Screen>

  return (
    <Screen>
      {shift.status === 'cancelled' ? <Banner tone="warning" message="This shift was removed from the schedule." /> : null}
      <Card>
        <Text variant="label" tone="muted">{formatDateLong(shift.date)}</Text>
        <Text variant="title">{formatShiftRange(shift)}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Badge label={formatDuration(shift.minutes)} tone="accent" />
          {!shift.published ? <Badge label="Draft" tone="warning" /> : null}
        </View>
      </Card>
      <Card style={{ paddingVertical: 4 }}>
        <Row icon="briefcase" label="Workplace" value={workplace?.name || 'Workplace'} />
        <Divider />
        <Row icon="user" label="Who" value={shift.staffName} />
        {shift.positionName ? <><Divider /><Row icon="tag" label="Position" value={shift.positionName} /></> : null}
        {shift.notes ? <><Divider /><Row icon="file-text" label="Notes" value={shift.notes} /></> : null}
      </Card>
      <TradeActions bizId={bizId} shiftId={shiftId} shift={shift} onOpenOffer={() => setActive(bizId)} />
      {shift.status !== 'cancelled' ? <AddToCalendar bizId={bizId} shiftId={shiftId} shift={shift} workplaceName={workplace?.name || 'Shift'} /> : null}
      <Text variant="caption" tone="faint">
        Times are in the workplace’s time zone.
      </Text>
    </Screen>
  )
}

function Row({ icon, label, value }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, alignItems: 'flex-start' }}
      accessible accessibilityLabel={`${label}: ${value}`}>
      <Feather name={icon} size={18} color={t.color.textMuted} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" tone="muted">{label}</Text>
        <Text>{value}</Text>
      </View>
    </View>
  )
}

// Offering or swapping, for the person working the shift. Shown only while
// the shift is still theirs to trade; the server has the final say.
function TradeActions({ bizId, shiftId, shift, onOpenOffer }) {
  const router = useRouter()
  const { user } = useAuth()
  const now = useNow()
  const [offering, setOffering] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const mine = shift.assigneeUid === user?.uid
  const future = shift.startAt?.toMillis?.() > now
  if (!mine || !shift.published || shift.status === 'cancelled' || !future) return null

  if (shift.openOfferId) {
    return (
      <Card>
        <Text variant="label">On the marketplace</Text>
        <Text tone="muted">It stays yours until someone picks it up.</Text>
        <Button title="See the offer" variant="secondary" onPress={() => { onOpenOffer(); router.push(`/offer/${shift.openOfferId}`) }} />
      </Card>
    )
  }
  if (shift.swapId) {
    return (
      <Card>
        <Text variant="label">Part of a swap request</Text>
        <Text tone="muted">You’ll find it under Requests.</Text>
        <Button title="Open Requests" variant="secondary" onPress={() => { onOpenOffer(); router.push('/requests') }} />
      </Card>
    )
  }

  async function offer() {
    setBusy(true)
    setError(null)
    try {
      await callTeams('offerShift', { bizId, shiftId, note })
      setOffering(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not offer this shift.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Banner message={error} />
      {offering ? (
        <Card>
          <Text>Your coworkers will see it on the marketplace. It stays yours until someone picks it up.</Text>
          <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Why you need it covered" />
          <Button title="Offer it" loading={busy} onPress={offer} />
          <Button title="Never mind" variant="ghost" onPress={() => setOffering(false)} />
        </Card>
      ) : (
        <>
          <Button title="Offer on the marketplace" icon="repeat" onPress={() => setOffering(true)} />
          <Button title="Swap with a coworker" icon="shuffle" variant="secondary"
            onPress={() => router.push({ pathname: '/swap-new', params: { bizId, shiftId } })} />
        </>
      )}
    </View>
  )
}

// One shift into a calendar by hand. For every shift, kept up to date,
// Profile → Calendar sync is the better way.
function AddToCalendar({ bizId, shiftId, shift, workplaceName }) {
  const event = shiftEvent({ ...shift, id: shiftId, startAt: shift.startAt.toDate(), endAt: shift.endAt.toDate() }, { bizId, workplaceName })
  function download() {
    const blob = new Blob([buildCalendar({ name: workplaceName, events: [event] })], { type: 'text/calendar' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `shift-${shift.date}.ics`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button title="Google Calendar" icon="calendar" variant="ghost" style={{ flex: 1 }}
        onPress={() => Linking.openURL(googleCalendarLink(event))} accessibilityHint="Opens Google Calendar with this shift filled in" />
      {Platform.OS === 'web' ? (
        <Button title="Download .ics" icon="download" variant="ghost" style={{ flex: 1 }} onPress={download}
          accessibilityHint="For Apple Calendar, Outlook and others" />
      ) : null}
    </View>
  )
}
