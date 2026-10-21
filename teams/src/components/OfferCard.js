import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { formatDuration, formatShiftRange, relativeDay } from '../../../shared/teams/time'
import { useAuth } from '../state/auth'
import { Badge, Text } from '../ui/components'
import { useTheme } from '../ui/theme'

// A shift on offer: when, how long, who is offering it, and where it stands
// for the person looking.
export default function OfferCard({ offer, today }) {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const mine = offer.offeredByUid === user?.uid
  const asked = offer.claimantUids?.includes(user?.uid)
  const waiting = offer.claimantUids?.length || 0
  const s = offer.shift
  const status = mine
    ? { label: waiting ? `${waiting} ${waiting === 1 ? 'request' : 'requests'}` : 'Your offer', tone: 'accent' }
    : asked ? { label: 'You asked', tone: 'warning' } : { label: 'Available', tone: 'success' }

  return (
    <Pressable
      onPress={() => router.push(`/offer/${offer.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${relativeDay(s.date, today)}, ${formatShiftRange(s)}, ${formatDuration(s.minutes)}${s.positionName ? `, ${s.positionName}` : ''}, offered by ${mine ? 'you' : offer.offeredByName}. ${status.label}`}
      style={({ pressed }) => ({ backgroundColor: pressed ? t.color.pressed : t.color.surface, borderRadius: t.radius.lg,
        borderWidth: 1, borderColor: t.color.border, padding: 16, gap: 8 })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="label" tone="muted">{relativeDay(s.date, today)}</Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      <Text variant="heading">{formatShiftRange(s)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Meta icon="clock" text={formatDuration(s.minutes)} />
        {s.positionName ? <Meta icon="tag" text={s.positionName} /> : null}
        <Meta icon="user" text={mine ? 'You' : offer.offeredByName} />
        <Meta icon={offer.requiresApproval ? 'shield' : 'zap'} text={offer.requiresApproval ? 'Manager approves' : 'Instant'} />
      </View>
      {offer.note ? <Text tone="muted" numberOfLines={2}>“{offer.note}”</Text> : null}
    </Pressable>
  )
}

function Meta({ icon, text }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Feather name={icon} size={13} color={t.color.textMuted} />
      <Text variant="caption" tone="muted">{text}</Text>
    </View>
  )
}
