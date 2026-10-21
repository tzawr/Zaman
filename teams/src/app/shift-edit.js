import { useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, View } from 'react-native'
import { doc, getDoc } from 'firebase/firestore'
import { ApiError, callTeams } from '../lib/api'
import { db } from '../lib/firebase'
import { closeModal } from '../lib/next'
import { useTeamAvailability, useTeamTimeOff } from '../state/availability'
import { useStaff, useToday } from '../state/shifts'
import { useWorkspace } from '../state/workspace'
import {
  addDays, formatDateShort, formatDuration, isDateString, normalizeTimeInput, resolveShiftTimes, weekDates, weekStartOf,
} from '../../../shared/teams/time'
import { availabilityProblem, timeOffClash } from '../../../shared/teams/availability'
import { Banner, Button, Card, Screen, Skeleton, Text, TextField } from '../ui/components'
import { useTheme } from '../ui/theme'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function ShiftEdit() {
  const router = useRouter()
  const params = useLocalSearchParams()
  const shiftId = params.shiftId ? String(params.shiftId) : null
  const today = useToday()
  const { activeId, active } = useWorkspace()
  const staff = useStaff()

  const [loaded, setLoaded] = useState(!shiftId)
  const [version, setVersion] = useState(undefined)
  const [staffId, setStaffId] = useState(null)
  const [date, setDate] = useState(isDateString(params.date) ? String(params.date) : today)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [positionName, setPositionName] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!shiftId || !activeId) return
    getDoc(doc(db, 'businesses', activeId, 'shifts', shiftId)).then((snap) => {
      if (!snap.exists()) { setError('That shift no longer exists.'); setLoaded(true); return }
      const s = snap.data()
      setVersion(s.version)
      setStaffId(s.staffId)
      setDate(s.date)
      setStart(s.startLocal)
      setEnd(s.endLocal)
      setPositionName(s.positionName || '')
      setNotes(s.notes || '')
      setLoaded(true)
    }).catch(() => { setError('Could not load this shift.'); setLoaded(true) })
  }, [shiftId, activeId])

  // A live preview of the length, using the same rules the server applies.
  const preview = useMemo(() => {
    const s = normalizeTimeInput(start)
    const e = normalizeTimeInput(end)
    if (!s || !e) return null
    return resolveShiftTimes({ date, start: s, end: e, timezone: 'UTC' })
  }, [date, start, end])

  const availability = useTeamAvailability()
  const timeOff = useTeamTimeOff(addDays(date, -1))

  // A warning, not a refusal: the manager may know something the
  // availability does not. The person's own requests are checked strictly.
  const warning = useMemo(() => {
    const s = normalizeTimeInput(start)
    const e = normalizeTimeInput(end)
    if (!staffId || !s || !e) return null
    const shift = { date, startLocal: s, endLocal: e }
    const name = staff?.find(p => p.id === staffId)?.name || 'They'
    const off = (timeOff || []).find(r => r.staffId === staffId && timeOffClash(shift, r))
    if (off) return `${name} ${off.status === 'approved' ? 'has approved time off' : 'has asked for time off'} then.`
    const outside = availabilityProblem(shift, availability?.[staffId])
    return outside ? `${name} ${outside}.` : null
  }, [staffId, date, start, end, staff, timeOff, availability])

  async function save() {
    setError('')
    const next = {}
    const s = normalizeTimeInput(start)
    const e = normalizeTimeInput(end)
    if (!staffId) next.staff = 'Choose who works this shift.'
    if (!s) next.start = 'Enter a time like 9:00 or 9am.'
    if (!e) next.end = 'Enter a time like 17:00 or 5pm.'
    setErrors(next)
    if (Object.keys(next).length) return
    setStart(s)
    setEnd(e)
    setBusy('save')
    try {
      await callTeams('saveShift', {
        bizId: activeId, shiftId: shiftId || undefined, expectedVersion: version,
        staffId, date, start: s, end: e, positionName, notes,
      })
      closeModal(router)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this shift.')
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    setError('')
    try {
      await callTeams('deleteShift', { bizId: activeId, shiftId })
      closeModal(router)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this shift.')
      setBusy(null)
    }
  }

  if (!loaded || staff === null) {
    return <Screen><Card><Skeleton width="40%" /><Skeleton height={44} /><Skeleton height={44} /></Card></Screen>
  }

  const weekStart = weekStartOf(date)
  return (
    <Screen>
      <Text variant="caption" tone="muted">Times are in {active?.name || 'the workplace'}’s time zone.</Text>

      <View style={{ gap: 8 }}>
        <Text variant="label" tone="muted" nativeID="who-label">Who</Text>
        {staff.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabelledBy="who-label"
            contentContainerStyle={{ gap: 8 }} accessibilityRole="radiogroup">
            {staff.map(p => <Chip key={p.id} label={p.name} selected={p.id === staffId} onPress={() => setStaffId(p.id)} />)}
          </ScrollView>
        ) : (
          <Banner tone="info" message="Your team is empty. Invite people from the Team tab first." />
        )}
        {errors.staff ? <Text variant="caption" tone="danger">{errors.staff}</Text> : null}
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="label" tone="muted">Day</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <SmallButton label="Previous week" text="‹" onPress={() => setDate(addDays(date, -7))} />
            <SmallButton label="Next week" text="›" onPress={() => setDate(addDays(date, 7))} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup">
          {weekDates(weekStart).map((d, i) => (
            <DayChip key={d} name={DAY_NAMES[i]} day={Number(d.slice(8))} selected={d === date} onPress={() => setDate(d)} label={formatDateShort(d)} />
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <TextField style={{ flex: 1 }} label="Start" value={start} onChangeText={setStart} error={errors.start}
          onBlur={() => setStart(v => normalizeTimeInput(v) || v)} autoCapitalize="none" autoCorrect={false} />
        <TextField style={{ flex: 1 }} label="End" value={end} onChangeText={setEnd} error={errors.end}
          onBlur={() => setEnd(v => normalizeTimeInput(v) || v)} autoCapitalize="none" autoCorrect={false} />
      </View>
      {preview?.ok ? (
        <Text variant="caption" tone="muted">
          {formatDuration(preview.value.minutes)}{preview.value.overnight ? ', ending the next morning' : ''}
        </Text>
      ) : preview ? <Text variant="caption" tone="danger">{preview.message}</Text> : null}

      {warning ? <Banner tone="warning" message={warning} /> : null}

      <TextField label="Position (optional)" value={positionName} onChangeText={setPositionName} placeholder="Barista" />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline
        placeholder="Visible to the person working it" style={{ minHeight: 0 }} />

      <Banner message={error} />
      <Button title={shiftId ? 'Save changes' : 'Add shift'} loading={busy === 'save'} disabled={Boolean(busy)} onPress={save} />
      {shiftId && !confirmDelete ? (
        <Button title="Remove shift" variant="danger" disabled={Boolean(busy)} onPress={() => setConfirmDelete(true)} />
      ) : null}
      {confirmDelete ? (
        <Card>
          <Text>Remove this shift? If the week is published, the person working it will see it was removed.</Text>
          <Button title="Remove" variant="danger" loading={busy === 'delete'} onPress={remove} />
          <Button title="Keep it" variant="ghost" onPress={() => setConfirmDelete(false)} />
        </Card>
      ) : null}
    </Screen>
  )
}

function Chip({ label, selected, onPress }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label}
      style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: 1.5,
        borderColor: selected ? t.color.accent : t.color.border, backgroundColor: selected ? t.color.accentBg : t.color.surface }}>
      <Text variant="label" style={{ color: selected ? t.color.accent : t.color.text }}>{label}</Text>
    </Pressable>
  )
}

function DayChip({ name, day, selected, onPress, label }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: t.radius.md, gap: 2,
        backgroundColor: selected ? t.color.accent : t.color.elevated }}>
      <Text variant="caption" style={{ color: selected ? t.color.onAccent : t.color.textMuted }}>{name}</Text>
      <Text variant="label" style={{ color: selected ? t.color.onAccent : t.color.text }}>{day}</Text>
    </Pressable>
  )
}

function SmallButton({ text, label, onPress }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={{ width: 36, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.elevated }}>
      <Text variant="heading">{text}</Text>
    </Pressable>
  )
}
