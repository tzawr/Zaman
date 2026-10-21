import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { formatDuration, formatShiftRange, relativeDay } from '../../../shared/teams/time'
import { Text } from '../ui/components'
import { useTheme } from '../ui/theme'

// One shift, as a row in a list. The coloured edge is the workplace's colour,
// so shifts from different jobs are told apart at a glance.
export default function ShiftCard({ shift, color, today, showDate = true, showWorkplace = false, onPress, prominent = false }) {
  const t = useTheme()
  const router = useRouter()
  const range = formatShiftRange(shift)
  const duration = formatDuration(shift.minutes)
  const when = showDate ? `${relativeDay(shift.date, today)}, ` : ''
  const label = [`${when}${range}`, duration, shift.positionName, showWorkplace ? shift.workplaceName : null]
    .filter(Boolean).join(', ')

  return (
    <Pressable
      onPress={onPress || (() => router.push(`/shift/${shift.bizId}/${shift.id}`))}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the shift"
      style={({ pressed }) => ({
        flexDirection: 'row', backgroundColor: pressed ? t.color.pressed : t.color.surface,
        borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border, overflow: 'hidden',
      })}
    >
      <View style={{ width: 5, backgroundColor: color || t.color.accent }} />
      <View style={{ flex: 1, padding: prominent ? 18 : 14, gap: 4 }}>
        {showDate ? (
          <Text variant="label" tone="muted">{relativeDay(shift.date, today)}</Text>
        ) : null}
        <Text variant={prominent ? 'title' : 'heading'} style={prominent ? { fontSize: 26 } : null}>{range}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <Meta icon="clock" text={duration} />
          {shift.positionName ? <Meta icon="tag" text={shift.positionName} /> : null}
          {showWorkplace ? <Meta icon="briefcase" text={shift.workplaceName} /> : null}
        </View>
      </View>
      <View style={{ justifyContent: 'center', paddingRight: 12 }}>
        <Feather name="chevron-right" size={18} color={t.color.textFaint} />
      </View>
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
