import { useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Pressable, Switch, View } from 'react-native'
import DateField from '../components/DateField'
import { ApiError, callTeams } from '../lib/api'
import { useAvailability, usePolicies } from '../state/availability'
import { useStaff, useToday } from '../state/shifts'
import { useWorkspace } from '../state/workspace'
import {
  DAY_KEYS, isAllDay, summarizeWeekly, upcomingVersion, validateWeekly, versionOn,
} from '../../../shared/teams/availability'
import { addDays, formatDateLong, formatDateShort, weekStartOf } from '../../../shared/teams/time'
import { Badge, Banner, Button, Card, Divider, Screen, Segmented, SectionTitle, SkeletonCard, Text, TextField } from '../ui/components'
import { useTheme } from '../ui/theme'

const DAY_LABELS = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' }

function emptyWeek() {
  return Object.fromEntries(DAY_KEYS.map(d => [d, { available: true, allDay: false, windows: [{ start: '09:00', end: '17:00' }] }]))
}

// Into the editor's shape: every day with an explicit all-day flag.
function toDraft(weekly) {
  if (!weekly) return emptyWeek()
  return Object.fromEntries(DAY_KEYS.map(d => {
    const day = weekly[d]
    if (!day?.available) return [d, { available: false, allDay: false, windows: [{ start: '09:00', end: '17:00' }] }]
    if (isAllDay(day)) return [d, { available: true, allDay: true, windows: [{ start: '09:00', end: '17:00' }] }]
    return [d, { available: true, allDay: false, windows: day.windows.map(w => ({ ...w })) }]
  }))
}

function fromDraft(draft) {
  return Object.fromEntries(DAY_KEYS.map(d => {
    const day = draft[d]
    if (!day.available) return [d, { available: false }]
    if (day.allDay) return [d, { available: true, windows: [] }]
    return [d, { available: true, windows: day.windows }]
  }))
}

// Weekly availability, temporary changes, and preferred hours. Opened with a
// staffId by a manager to see or change someone else's.
export default function Availability() {
  const params = useLocalSearchParams()
  const staffParam = params.staffId ? String(params.staffId) : null
  const { activeId, member, isManager } = useWorkspace()
  const { availability, loading, error: loadError, staffId } = useAvailability(staffParam)
  const policies = usePolicies()
  const staff = useStaff()
  const today = useToday()
  const self = !staffParam || staffParam === member?.staffId
  const person = staff?.find(s => s.id === staffId)
  const locked = self && !isManager && policies?.employeesCanSubmitAvailability === false

  if (loading || !policies) return <Screen><SkeletonCard lines={3} /><SkeletonCard lines={3} /></Screen>
  return (
    <Screen>
      {!self ? <Text variant="heading">{person?.name || 'Team member'}</Text> : null}
      <Banner message={loadError} />
      {locked ? <Banner tone="info" message="Your manager sets availability at this workplace. Ask them if something changes." /> : null}
      <WeeklyEditor key={staffId} bizId={activeId} staffId={staffParam}
        availability={availability} today={today} locked={locked} self={self} />
      <Overrides bizId={activeId} staffId={staffParam} availability={availability} today={today} locked={locked} />
    </Screen>
  )
}

function WeeklyEditor({ bizId, staffId, availability, today, locked, self }) {
  const current = versionOn(availability, today)
  const upcoming = upcomingVersion(availability, today)
  const [editing, setEditing] = useState(upcoming ? 'upcoming' : 'current')
  const base = editing === 'upcoming' && upcoming ? upcoming : current
  const [draft, setDraft] = useState(() => toDraft(base?.weekly))
  const [preferred, setPreferred] = useState(base?.preferredHoursPerWeek != null ? String(base.preferredHoursPerWeek) : '')
  const nextMonday = addDays(weekStartOf(today), 7)
  const [when, setWhen] = useState(upcoming ? 'date' : 'now')
  const [effectiveFrom, setEffectiveFrom] = useState(upcoming?.effectiveFrom || nextMonday)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const preview = useMemo(() => validateWeekly(fromDraft(draft)), [draft])

  // Switching between the current week and a scheduled change loads that
  // version into the editor.
  function switchEditing(next) {
    setEditing(next)
    if (next === 'upcoming' && upcoming) {
      setDraft(toDraft(upcoming.weekly)); setWhen('date'); setEffectiveFrom(upcoming.effectiveFrom)
    } else {
      setDraft(toDraft(current?.weekly)); setWhen('now')
    }
  }

  const setDay = (day, patch) => setDraft(d => ({ ...d, [day]: { ...d[day], ...patch } }))

  async function save() {
    setNotice(null)
    if (!preview.ok) { setNotice({ tone: 'danger', message: preview.message }); return }
    setBusy(true)
    try {
      const r = await callTeams('saveAvailability', {
        bizId, staffId: staffId || undefined, weekly: fromDraft(draft), preferredHoursPerWeek: preferred,
        effectiveFrom: when === 'now' ? today : effectiveFrom,
      })
      setNotice({ tone: 'success', message: r.effectiveFrom === today ? 'Saved. Your manager can see it now.' : `Saved. It applies from ${formatDateLong(r.effectiveFrom)}.` })
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not save availability.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <Text variant="label" tone="muted">{self ? 'Your week' : 'Their week'}</Text>
        <Text>{current ? summarizeWeekly(current.weekly) : 'Not set yet. Until it is, managers can schedule any time.'}</Text>
        {upcoming ? (
          <View style={{ gap: 4 }}>
            <Badge label={`Changes ${formatDateShort(upcoming.effectiveFrom)}`} tone="warning" />
            <Text tone="muted">{summarizeWeekly(upcoming.weekly)}</Text>
          </View>
        ) : null}
      </Card>

      {!locked ? (
        <>
          {upcoming ? (
            <Segmented accessibilityLabel="Which week to edit" value={editing} onChange={switchEditing}
              options={[{ value: 'current', label: 'Current' }, { value: 'upcoming', label: `From ${formatDateShort(upcoming.effectiveFrom)}` }]} />
          ) : null}
          <SectionTitle>Weekly availability</SectionTitle>
          <Card style={{ paddingVertical: 6 }}>
            {DAY_KEYS.map((day, i) => (
              <View key={day}>
                {i > 0 ? <Divider /> : null}
                <DayRow label={DAY_LABELS[day]} value={draft[day]} onChange={(patch) => setDay(day, patch)} />
              </View>
            ))}
          </Card>
          <TextField label="Hours you’d like each week (optional)" value={preferred} onChangeText={setPreferred}
            keyboardType="number-pad" placeholder="e.g. 25" />
          <View style={{ gap: 8 }}>
            <Text variant="label" tone="muted">Starting</Text>
            <Segmented accessibilityLabel="When this applies" value={when} onChange={setWhen}
              options={[{ value: 'now', label: 'Now' }, { value: 'date', label: 'From a date' }]} />
            {when === 'date' ? <DateField label="Applies from" value={effectiveFrom} onChange={setEffectiveFrom} min={addDays(today, 1)} /> : null}
          </View>
          {!preview.ok ? <Text variant="caption" tone="danger">{preview.message}</Text> : null}
          <Banner tone={notice?.tone} message={notice?.message} />
          <Button title="Save availability" loading={busy} onPress={save} />
        </>
      ) : null}
    </>
  )
}

function DayRow({ label, value, onChange }) {
  const t = useTheme()
  const setWindow = (i, field, v) => onChange({ windows: value.windows.map((w, j) => (j === i ? { ...w, [field]: v } : w)) })
  return (
    <View style={{ paddingVertical: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="caption" tone="muted">{value.available ? 'Available' : 'Off'}</Text>
          <Switch value={value.available} onValueChange={(v) => onChange({ available: v })}
            accessibilityLabel={`${label} available`} trackColor={{ true: t.color.accent }} />
        </View>
      </View>
      {value.available ? (
        <>
          <Segmented accessibilityLabel={`${label} hours`} value={value.allDay ? 'all' : 'hours'}
            onChange={(v) => onChange({ allDay: v === 'all' })}
            options={[{ value: 'all', label: 'All day' }, { value: 'hours', label: 'Set hours' }]} />
          {!value.allDay ? value.windows.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <TextField style={{ flex: 1 }} label={i === 0 ? 'From' : 'And from'} value={w.start}
                onChangeText={(v) => setWindow(i, 'start', v)} autoCapitalize="none" />
              <TextField style={{ flex: 1 }} label="To" value={w.end} onChangeText={(v) => setWindow(i, 'end', v)} autoCapitalize="none" />
              {i === 1 ? (
                <Pressable onPress={() => onChange({ windows: value.windows.slice(0, 1) })} accessibilityRole="button"
                  accessibilityLabel={`Remove second ${label} window`} style={{ minHeight: 50, justifyContent: 'center', paddingHorizontal: 6 }}>
                  <Text tone="danger">Remove</Text>
                </Pressable>
              ) : null}
            </View>
          )) : null}
          {!value.allDay && value.windows.length === 1 ? (
            <Pressable onPress={() => onChange({ windows: [...value.windows, { start: '17:00', end: '21:00' }] })}
              accessibilityRole="button" accessibilityLabel={`Add a second ${label} window`} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
              <Text variant="label" tone="accent">+ Add a second window</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

function Overrides({ bizId, staffId, availability, today, locked }) {
  const [adding, setAdding] = useState(false)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [mode, setMode] = useState('off')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('13:00')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  const list = (availability?.overrides || []).filter(o => o.to >= today)

  async function add() {
    setBusy('add')
    setNotice(null)
    try {
      await callTeams('addAvailabilityOverride', {
        bizId, staffId: staffId || undefined, from, to: to < from ? from : to,
        unavailable: mode === 'off', window: { start, end }, reason,
      })
      setAdding(false)
      setReason('')
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not add the change.' })
    } finally {
      setBusy(null)
    }
  }

  async function remove(id) {
    setBusy(id)
    try {
      await callTeams('removeAvailabilityOverride', { bizId, staffId: staffId || undefined, overrideId: id })
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not remove it.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <SectionTitle>Temporary changes</SectionTitle>
      <Text variant="caption" tone="muted">For exams, a trip, a short stretch with different hours. This isn’t time off; ask for that under Requests.</Text>
      {list.map(o => (
        <Card key={o.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text>{o.from === o.to ? formatDateShort(o.from) : `${formatDateShort(o.from)} – ${formatDateShort(o.to)}`}</Text>
            <Text variant="caption" tone="muted">
              {o.unavailable ? 'Not available' : `Only ${o.windows[0].start}–${o.windows[0].end}`}{o.reason ? ` · ${o.reason}` : ''}
            </Text>
          </View>
          {!locked ? <Button title="Remove" variant="ghost" loading={busy === o.id} onPress={() => remove(o.id)}
            style={{ minHeight: 40, paddingHorizontal: 8 }} accessibilityHint="Removes this temporary change" /> : null}
        </Card>
      ))}
      <Banner tone={notice?.tone} message={notice?.message} />
      {locked ? null : adding ? (
        <Card>
          <DateField label="From" value={from} onChange={(d) => { setFrom(d); if (to < d) setTo(d) }} min={today} />
          <DateField label="To" value={to} onChange={setTo} min={from} />
          <Segmented accessibilityLabel="Kind of change" value={mode} onChange={setMode}
            options={[{ value: 'off', label: 'Not available' }, { value: 'hours', label: 'Different hours' }]} />
          {mode === 'hours' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextField style={{ flex: 1 }} label="From" value={start} onChangeText={setStart} autoCapitalize="none" />
              <TextField style={{ flex: 1 }} label="To" value={end} onChangeText={setEnd} autoCapitalize="none" />
            </View>
          ) : null}
          <TextField label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Exams" />
          <Button title="Add change" loading={busy === 'add'} onPress={add} />
          <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button title="Add a temporary change" icon="plus" variant="secondary" onPress={() => setAdding(true)} />
      )}
    </>
  )
}
