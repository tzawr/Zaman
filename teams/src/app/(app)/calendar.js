import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import ShiftCard from '../../components/ShiftCard'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { useMyShifts, useToday, useWorkplaceColors } from '../../state/shifts'
import { useWorkspace } from '../../state/workspace'
import {
  addDays, addMonths, formatDateLong, formatDateShort, formatDuration, formatMonthYear, formatWeekRange,
  monthGrid, monthOf, weekDates, weekStartOf,
} from '../../../../shared/teams/time'
import { Banner, Card, EmptyState, Screen, Segmented, SkeletonCard, Text } from '../../ui/components'
import { useTheme } from '../../ui/theme'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const VIEWS = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]

// Every workplace's shifts on one calendar, each in its workplace's colour.
export default function Calendar() {
  const today = useToday()
  const { workplaces } = useWorkspace()
  const colors = useWorkplaceColors()
  const [view, setView] = useState('week')
  const [cursor, setCursor] = useState(today)
  const multiple = (workplaces?.length || 0) > 1

  const range = useMemo(() => {
    if (view === 'day') return { from: cursor, to: cursor, title: formatDateLong(cursor) }
    if (view === 'week') {
      const start = weekStartOf(cursor)
      return { from: start, to: addDays(start, 6), title: formatWeekRange(start) }
    }
    const { year, monthIndex } = monthOf(cursor)
    const grid = monthGrid(year, monthIndex)
    return { from: grid[0][0], to: grid.at(-1)[6], grid, title: formatMonthYear(cursor) }
  }, [view, cursor])

  const { shifts, loading, error } = useMyShifts(range.from, range.to)
  const byDate = useMemo(() => {
    const map = {}
    for (const s of shifts) (map[s.date] ||= []).push(s)
    return map
  }, [shifts])

  function step(direction) {
    if (view === 'day') setCursor(addDays(cursor, direction))
    else if (view === 'week') setCursor(addDays(cursor, 7 * direction))
    else setCursor(addMonths(cursor, direction))
  }

  const totalMinutes = shifts.reduce((sum, s) => sum + (s.minutes || 0), 0)

  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Calendar" />
      <Screen>
        <Segmented accessibilityLabel="Calendar view" options={VIEWS} value={view} onChange={setView} />
        <Navigator title={range.title} onPrev={() => step(-1)} onNext={() => step(1)}
          onToday={cursor === today ? null : () => setCursor(today)} view={view} />
        {multiple ? <Legend colors={colors} workplaces={workplaces} /> : null}
        <Banner message={error} />

        {loading ? <SkeletonCard lines={3} /> : view === 'month' ? (
          <>
            <MonthGrid grid={range.grid} cursor={cursor} today={today} byDate={byDate} colors={colors} onSelect={setCursor} />
            <DayList date={cursor} shifts={byDate[cursor] || []} colors={colors} today={today} multiple={multiple} heading />
          </>
        ) : view === 'week' ? (
          <>
            {totalMinutes ? (
              <Text tone="muted">{formatDuration(totalMinutes)} across {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'}</Text>
            ) : null}
            {weekDates(range.from).map(date => (
              <DayList key={date} date={date} shifts={byDate[date] || []} colors={colors} today={today} multiple={multiple} heading compact />
            ))}
          </>
        ) : (
          <DayList date={cursor} shifts={byDate[cursor] || []} colors={colors} today={today} multiple={multiple} />
        )}
      </Screen>
    </View>
  )
}

function Navigator({ title, onPrev, onNext, onToday, view }) {
  const t = useTheme()
  const unit = { day: 'day', week: 'week', month: 'month' }[view]
  const arrow = (icon, onPress, label) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? t.color.pressed : t.color.elevated })}>
      <Feather name={icon} size={20} color={t.color.text} />
    </Pressable>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {arrow('chevron-left', onPrev, `Previous ${unit}`)}
      <Text variant="heading" style={{ flex: 1, textAlign: 'center' }} accessibilityRole="header" accessibilityLiveRegion="polite">{title}</Text>
      {arrow('chevron-right', onNext, `Next ${unit}`)}
      {onToday ? (
        <Pressable onPress={onToday} accessibilityRole="button" accessibilityLabel="Go to today" hitSlop={8}
          style={{ paddingHorizontal: 12, height: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: t.color.accentBg }}>
          <Text variant="label" tone="accent">Today</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function Legend({ colors, workplaces }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} accessibilityLabel="Workplace colours">
      {workplaces.map(w => (
        <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors[w.id] }} />
          <Text variant="caption" tone="muted">{w.name}</Text>
        </View>
      ))}
    </View>
  )
}

function MonthGrid({ grid, cursor, today, byDate, colors, onSelect }) {
  const t = useTheme()
  const month = cursor.slice(0, 7)
  return (
    <Card style={{ padding: 10, gap: 4 }}>
      <View style={{ flexDirection: 'row' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAYS.map((d, i) => <Text key={i} variant="caption" tone="faint" style={{ flex: 1, textAlign: 'center' }}>{d}</Text>)}
      </View>
      {grid.map(week => (
        <View key={week[0]} style={{ flexDirection: 'row' }}>
          {week.map(date => {
            const shifts = byDate[date] || []
            const selected = date === cursor
            const isToday = date === today
            const inMonth = date.slice(0, 7) === month
            const dots = [...new Set(shifts.map(s => s.bizId))].slice(0, 3)
            return (
              <Pressable key={date} onPress={() => onSelect(date)} accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${formatDateShort(date)}${isToday ? ', today' : ''}, ${shifts.length ? `${shifts.length} ${shifts.length === 1 ? 'shift' : 'shifts'}` : 'no shifts'}`}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 6, gap: 3, minHeight: 48 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: selected ? t.color.accent : isToday ? t.color.accentBg : 'transparent' }}>
                  <Text style={{ fontWeight: isToday || selected ? '700' : '400',
                    color: selected ? t.color.onAccent : inMonth ? t.color.text : t.color.textFaint }}>
                    {Number(date.slice(8))}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
                  {dots.map(id => <View key={id} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors[id] }} />)}
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}
    </Card>
  )
}

function DayList({ date, shifts, colors, today, multiple, heading = false, compact = false }) {
  const t = useTheme()
  const isToday = date === today
  return (
    <View style={{ gap: 8 }}>
      {heading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: compact ? 2 : 6 }}>
          <Text variant="label" style={{ color: isToday ? t.color.accent : t.color.text }} accessibilityRole="header">
            {formatDateShort(date)}{isToday ? ' · Today' : ''}
          </Text>
        </View>
      ) : null}
      {shifts.length ? shifts.map(s => (
        <ShiftCard key={`${s.bizId}/${s.id}`} shift={s} color={colors[s.bizId]} today={today} showDate={false} showWorkplace={multiple} />
      )) : compact ? (
        <Text variant="caption" tone="faint">No shifts</Text>
      ) : (
        <Card><EmptyState icon="sun" title="Nothing scheduled" message="You have no shifts on this day." /></Card>
      )}
    </View>
  )
}
