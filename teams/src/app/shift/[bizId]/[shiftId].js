import { useEffect, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useWorkspace } from '../../../state/workspace'
import { formatDateLong, formatDuration, formatShiftRange } from '../../../../../shared/teams/time'
import { Badge, Banner, Card, Divider, Screen, SkeletonCard, Text } from '../../../ui/components'
import { useTheme } from '../../../ui/theme'

export default function ShiftDetail() {
  const params = useLocalSearchParams()
  const bizId = String(params.bizId)
  const shiftId = String(params.shiftId)
  const { workplaces } = useWorkspace()
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
