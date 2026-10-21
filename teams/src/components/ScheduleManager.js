import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { ApiError, callTeams } from '../lib/api'
import { useToday, useWeekSchedule } from '../state/shifts'
import { useWorkspace } from '../state/workspace'
import {
  addDays, formatDateShort, formatDuration, formatShiftRange, formatWeekRange, weekDates, weekStartOf,
} from '../../../shared/teams/time'
import { Badge, Banner, Button, Card, Divider, SkeletonCard, Text } from '../ui/components'
import { useTheme } from '../ui/theme'

// The manager's week: build it shift by shift, then publish it to the team.
export default function ScheduleManager() {
  const router = useRouter()
  const t = useTheme()
  const today = useToday()
  const { activeId } = useWorkspace()
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today))
  const { schedule, shifts, loading, error } = useWeekSchedule(weekStart)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [notice, setNotice] = useState(null)

  const byDate = useMemo(() => {
    const map = {}
    for (const s of shifts || []) (map[s.date] ||= []).push(s)
    return map
  }, [shifts])

  const published = schedule?.status === 'published'
  const count = shifts?.length || 0
  const minutes = (shifts || []).reduce((sum, s) => sum + (s.minutes || 0), 0)
  const people = new Set((shifts || []).map(s => s.staffId)).size

  async function publish() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await callTeams('publishSchedule', { bizId: activeId, weekStart })
      setNotice({ tone: 'success', message: `Published ${result.published} ${result.published === 1 ? 'shift' : 'shifts'}. Your team can see them now.` })
      setConfirm(false)
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not publish this week.' })
    } finally {
      setBusy(false)
    }
  }

  const add = (date) => router.push({ pathname: '/shift-edit', params: { date } })

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconButton icon="chevron-left" label="Previous week" onPress={() => { setWeekStart(addDays(weekStart, -7)); setConfirm(false) }} />
        <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <Text variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite">{formatWeekRange(weekStart)}</Text>
          {!loading ? (
            <Badge label={!schedule ? 'Not started' : published ? 'Published' : 'Draft'} tone={published ? 'success' : schedule ? 'warning' : 'neutral'} />
          ) : null}
        </View>
        <IconButton icon="chevron-right" label="Next week" onPress={() => { setWeekStart(addDays(weekStart, 7)); setConfirm(false) }} />
      </View>

      <Banner message={error} />
      <Banner tone={notice?.tone} message={notice?.message} />

      {loading ? <><SkeletonCard lines={2} /><SkeletonCard lines={2} /></> : (
        <>
          <Card style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <Stat label="Shifts" value={String(count)} />
            <Stat label="Hours" value={minutes ? formatDuration(minutes) : '0h'} />
            <Stat label="People" value={String(people)} />
          </Card>

          {published ? (
            <Text variant="caption" tone="muted">This week is published. Changes you make go live for your team as you save them.</Text>
          ) : count ? (
            confirm ? (
              <Card>
                <Text>Publish {count} {count === 1 ? 'shift' : 'shifts'} for {formatWeekRange(weekStart)}? Everyone on this schedule will be able to see their shifts.</Text>
                <Button title="Publish" loading={busy} onPress={publish} />
                <Button title="Not yet" variant="ghost" onPress={() => setConfirm(false)} />
              </Card>
            ) : (
              <Button title="Publish this week" icon="send" onPress={() => setConfirm(true)} />
            )
          ) : null}

          {weekDates(weekStart).map(date => (
            <Card key={date} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="label" style={date === today ? { color: t.color.accent } : null} accessibilityRole="header">
                  {formatDateShort(date)}{date === today ? ' · Today' : ''}
                </Text>
                <Pressable onPress={() => add(date)} accessibilityRole="button" accessibilityLabel={`Add a shift on ${formatDateShort(date)}`}
                  hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 6 }}>
                  <Feather name="plus" size={16} color={t.color.accent} />
                  <Text variant="label" tone="accent">Add</Text>
                </Pressable>
              </View>
              {(byDate[date] || []).length ? (byDate[date]).map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable onPress={() => router.push({ pathname: '/shift-edit', params: { shiftId: s.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.staffName}, ${formatShiftRange(s)}${s.positionName ? `, ${s.positionName}` : ''}. Edit`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={1}>{s.staffName}</Text>
                      <Text variant="caption" tone="muted">
                        {formatShiftRange(s)} · {formatDuration(s.minutes)}{s.positionName ? ` · ${s.positionName}` : ''}
                      </Text>
                    </View>
                    {!s.assigneeUid ? <Badge label="No account" tone="neutral" /> : null}
                    <Feather name="chevron-right" size={16} color={t.color.textFaint} />
                  </Pressable>
                </View>
              )) : <Text variant="caption" tone="faint">No shifts</Text>}
            </Card>
          ))}
        </>
      )}
    </>
  )
}

function Stat({ label, value }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" tone="muted">{label}</Text>
    </View>
  )
}

function IconButton({ icon, label, onPress }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? t.color.pressed : t.color.elevated })}>
      <Feather name={icon} size={20} color={t.color.text} />
    </Pressable>
  )
}
