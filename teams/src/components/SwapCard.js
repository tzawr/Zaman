import { View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { formatDuration, formatShiftRange, relativeDay } from '../../../shared/teams/time'
import { useAuth } from '../state/auth'
import { Badge, Card, Text } from '../ui/components'
import { useTheme } from '../ui/theme'

const STATUS = {
  pending_peer: ['Waiting for reply', 'warning'],
  pending_manager: ['Waiting for manager', 'warning'],
  completed: ['Swapped', 'success'],
  declined: ['Declined', 'neutral'],
  rejected: ['Not approved', 'danger'],
  cancelled: ['Cancelled', 'neutral'],
  expired: ['Expired', 'neutral'],
}

// A swap from the reader's side: what they give and what they get. A manager
// sees it as one person's shift for another's.
export default function SwapCard({ swap, today, children }) {
  const t = useTheme()
  const { user } = useAuth()
  const iAsked = swap.requesterUid === user?.uid
  const iReceived = swap.counterpartyUid === user?.uid
  const [label, tone] = STATUS[swap.status] || [swap.status, 'neutral']
  const give = iReceived ? swap.shiftB : swap.shiftA
  const get = iReceived ? swap.shiftA : swap.shiftB
  const title = iAsked ? `Swap with ${swap.counterpartyName}`
    : iReceived ? `${swap.requesterName} wants to swap`
    : `${swap.requesterName} ↔ ${swap.counterpartyName}`
  const giveLabel = iAsked || iReceived ? 'You give' : `${swap.requesterName} gives`
  const getLabel = iAsked || iReceived ? 'You get' : `${swap.counterpartyName} gives`

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text variant="label" style={{ flex: 1 }}>{title}</Text>
        <Badge label={label} tone={tone} />
      </View>
      <Side label={giveLabel} shift={give} today={today} icon="arrow-up-right" color={t.color.textMuted} />
      <Side label={getLabel} shift={get} today={today} icon="arrow-down-left" color={t.color.accent} />
      {swap.note ? <Text tone="muted">“{swap.note}”</Text> : null}
      {children}
    </Card>
  )
}

function Side({ label, shift, today, icon, color }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}
      accessible accessibilityLabel={`${label}: ${relativeDay(shift.date, today)}, ${formatShiftRange(shift)}`}>
      <Feather name={icon} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="muted">{label}</Text>
        <Text>{relativeDay(shift.date, today)} · {formatShiftRange(shift)} · {formatDuration(shift.minutes)}</Text>
      </View>
    </View>
  )
}
