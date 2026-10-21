import { View } from 'react-native'
import { describeTimeOff } from '../../../shared/teams/availability'
import { Badge, Card, Text } from '../ui/components'

const STATUS = {
  pending: ['Waiting for manager', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Declined', 'danger'],
  cancelled: ['Cancelled', 'neutral'],
}

export default function TimeOffCard({ request, labels, showName = false, children }) {
  const [label, tone] = STATUS[request.status] || [request.status, 'neutral']
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text variant="label" style={{ flex: 1 }}>
          {showName ? `${request.staffName} · ` : ''}{labels?.[request.category] || request.category}
        </Text>
        <Badge label={label} tone={tone} />
      </View>
      <Text>{describeTimeOff(request)}</Text>
      {request.reason ? <Text tone="muted">“{request.reason}”</Text> : null}
      {request.managerNote ? <Text variant="caption" tone="muted">Manager: {request.managerNote}</Text> : null}
      {children}
    </Card>
  )
}
