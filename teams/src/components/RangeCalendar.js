import { useState } from 'react'
import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { addDays, daysBetween, formatDateLong, formatDateShort, weekStartOf } from '../../../shared/teams/time'
import { Text } from '../ui/components'
import { useTheme } from '../ui/theme'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const LENGTHS = [{ weeks: 1, label: '1 week' }, { weeks: 2, label: '2 weeks' }, { weeks: 4, label: '4 weeks' }]

// The six weeks shown for a month, Monday first.
function monthGrid(month) {
  const first = weekStartOf(`${month}-01`)
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)))
}

function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

// Picking a stretch of days: tap the first, then the last, or a length.
// `value` is { from, to } as YYYY-MM-DD; `onChange` gets the same shape.
export default function RangeCalendar({ value, onChange }) {
  const t = useTheme()
  const [month, setMonth] = useState(value.from.slice(0, 7))
  // After a first tap, the next tap ends the range.
  const [picking, setPicking] = useState(false)
  const { from, to } = value

  function tap(date) {
    if (!picking) {
      onChange({ from: date, to: date })
      setPicking(true)
    } else {
      onChange(date < from ? { from: date, to: from } : { from, to: date })
      setPicking(false)
    }
  }

  const [y, m] = month.split('-').map(Number)
  const days = daysBetween(from, to) + 1
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <NavButton icon="chevron-left" label="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} />
        <Text variant="label" style={{ flex: 1, textAlign: 'center' }} accessibilityRole="header" accessibilityLiveRegion="polite">
          {MONTHS[m - 1]} {y}
        </Text>
        <NavButton icon="chevron-right" label="Next month" onPress={() => setMonth(shiftMonth(month, 1))} />
      </View>

      <View style={{ flexDirection: 'row' }} aria-hidden>
        {WEEKDAYS.map((d, i) => <Text key={i} variant="caption" tone="faint" style={{ flex: 1, textAlign: 'center' }}>{d}</Text>)}
      </View>
      {monthGrid(month).map(week => (
        <View key={week[0]} style={{ flexDirection: 'row' }}>
          {week.map(date => {
            const inMonth = date.slice(0, 7) === month
            const edge = date === from || date === to
            const inside = date > from && date < to
            return (
              <Pressable key={date} onPress={() => tap(date)} accessibilityRole="button"
                accessibilityLabel={`${formatDateLong(date)}${date === from ? ', first day' : ''}${date === to ? ', last day' : ''}${inside ? ', included' : ''}`}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 2, minHeight: 44, justifyContent: 'center',
                  backgroundColor: inside || (edge && from !== to) ? t.color.accentBg : 'transparent',
                  borderTopLeftRadius: date === from ? 18 : 0, borderBottomLeftRadius: date === from ? 18 : 0,
                  borderTopRightRadius: date === to ? 18 : 0, borderBottomRightRadius: date === to ? 18 : 0 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: edge ? t.color.accent : 'transparent' }}>
                  <Text style={{ fontWeight: edge ? '700' : '400',
                    color: edge ? t.color.onAccent : inMonth ? t.color.text : t.color.textFaint }}>
                    {Number(date.slice(8))}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {LENGTHS.map(l => {
          const end = addDays(from, l.weeks * 7 - 1)
          const chosen = to === end
          return (
            <Pressable key={l.weeks} onPress={() => { onChange({ from, to: end }); setPicking(false) }} accessibilityRole="button"
              accessibilityLabel={`${l.label} from ${formatDateShort(from)}${chosen ? ', chosen' : ''}`}
              style={{ flex: 1, minHeight: 40, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                borderColor: chosen ? t.color.accent : t.color.border, backgroundColor: chosen ? t.color.accentBg : t.color.elevated }}>
              <Text variant="label" style={chosen ? { color: t.color.accent } : null}>{l.label}</Text>
            </Pressable>
          )
        })}
      </View>
      <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {picking ? 'Now tap the last day.' : `${formatDateShort(from)} – ${formatDateShort(to)} · ${days} ${days === 1 ? 'day' : 'days'}`}
      </Text>
    </View>
  )
}

function NavButton({ icon, label, onPress }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.elevated }}>
      <Feather name={icon} size={18} color={t.color.text} />
    </Pressable>
  )
}
