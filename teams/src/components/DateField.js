import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { addDays, formatDateLong, isDateString } from '../../../shared/teams/time'
import { Text } from '../ui/components'
import { useTheme } from '../ui/theme'

// A date, stepped a day at a time or typed as YYYY-MM-DD. The same control
// on phones and the web, readable and operable by screen readers.
export default function DateField({ label, value, onChange, min, max }) {
  const t = useTheme()
  const [typing, setTyping] = useState(null)
  const clamp = (d) => (min && d < min ? min : max && d > max ? max : d)
  const step = (n) => onChange(clamp(addDays(value, n)))

  const arrow = (icon, n, a11y, disabled) => (
    <Pressable onPress={() => step(n)} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y}
      accessibilityState={{ disabled }} hitSlop={6}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.color.elevated, opacity: disabled ? 0.4 : 1 }}>
      <Feather name={icon} size={18} color={t.color.text} />
    </Pressable>
  )

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="label" tone="muted">{label}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.color.surface, borderRadius: t.radius.md,
        borderWidth: 1.5, borderColor: t.color.border, padding: 5 }}>
        {arrow('chevron-left', -1, `${label || 'Date'}: previous day`, Boolean(min && value <= min))}
        {typing === null ? (
          <Pressable onPress={() => setTyping(value)} accessibilityRole="button"
            accessibilityLabel={`${label || 'Date'}: ${formatDateLong(value)}. Tap to type a date`}
            style={{ flex: 1, alignItems: 'center', minHeight: 40, justifyContent: 'center' }}>
            <Text>{formatDateLong(value)}</Text>
          </Pressable>
        ) : (
          <TextInput
            autoFocus
            value={typing}
            onChangeText={setTyping}
            onBlur={() => { if (isDateString(typing)) onChange(clamp(typing)); setTyping(null) }}
            onSubmitEditing={() => { if (isDateString(typing)) onChange(clamp(typing)); setTyping(null) }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={t.color.textFaint}
            accessibilityLabel={`${label || 'Date'}, as year-month-day`}
            style={[t.font.body, { flex: 1, textAlign: 'center', color: t.color.text, minHeight: 40 }]}
          />
        )}
        {arrow('chevron-right', 1, `${label || 'Date'}: next day`, Boolean(max && value >= max))}
      </View>
    </View>
  )
}
