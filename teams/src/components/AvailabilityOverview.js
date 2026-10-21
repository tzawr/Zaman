import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { usePolicies, useTeamAvailability, useTeamTimeOff } from '../state/availability'
import { useStaff, useToday } from '../state/shifts'
import { describeTimeOff, summarizeWeekly, upcomingVersion, versionOn } from '../../../shared/teams/availability'
import { daysBetween, formatDateShort } from '../../../shared/teams/time'
import { Badge, Card, Divider, ListRow, SkeletonCard, Text } from '../ui/components'

function ago(timestamp, today) {
  const date = timestamp?.toDate?.()
  if (!date) return null
  const days = daysBetween(date.toISOString().slice(0, 10), today)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

// Everyone's availability at a glance, for a manager about to build a week:
// what each person can work, what is about to change, and who is off.
export default function AvailabilityOverview() {
  const router = useRouter()
  const today = useToday()
  const staff = useStaff()
  const availability = useTeamAvailability()
  const timeOff = useTeamTimeOff(today)
  const policies = usePolicies()

  if (!staff || availability === undefined || timeOff === null) return <><SkeletonCard lines={2} /><SkeletonCard lines={2} /></>

  return (
    <>
      <Text tone="muted">What your team said they can work. Recent changes are marked so you see them before building the next week.</Text>
      <Card style={{ paddingVertical: 4 }}>
        {staff.map((p, i) => {
          const a = availability?.[p.id]
          const current = versionOn(a, today)
          const next = upcomingVersion(a, today)
          const recent = a?.updatedAt && daysBetween(a.updatedAt.toDate().toISOString().slice(0, 10), today) <= 7
          const overrides = (a?.overrides || []).filter(o => o.to >= today)
          const off = timeOff.filter(r => r.staffId === p.id)
          return (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                title={p.name}
                subtitleLines={0}
                subtitle={[
                  current ? summarizeWeekly(current.weekly) : 'No availability set',
                  current?.preferredHoursPerWeek != null ? `wants ${current.preferredHoursPerWeek}h a week` : null,
                  ...overrides.map(o => `${o.unavailable ? 'Unavailable' : 'Changed hours'} ${o.from === o.to ? formatDateShort(o.from) : `${formatDateShort(o.from)}–${formatDateShort(o.to)}`}`),
                  ...off.map(r => `${r.status === 'approved' ? 'Off' : 'Asked off'} ${describeTimeOff(r)} (${policies?.labels[r.category] || r.category})`),
                ].filter(Boolean).join('\n')}
                onPress={() => router.push({ pathname: '/availability', params: { staffId: p.id } })}
                accessibilityLabel={`${p.name}. Open availability`}
                right={next ? <Badge label={`Changes ${formatDateShort(next.effectiveFrom)}`} tone="warning" />
                  : recent ? <Badge label={`Updated ${ago(a.updatedAt, today)}`} tone="accent" /> : undefined}
              />
            </View>
          )
        })}
      </Card>
    </>
  )
}
