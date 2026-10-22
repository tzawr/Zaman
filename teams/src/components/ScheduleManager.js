import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { ApiError, callTeams } from '../lib/api'
import { useTeamAvailability, useTeamTimeOff } from '../state/availability'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useToday, useWeekSchedule } from '../state/shifts'
import { useWorkspace } from '../state/workspace'
import {
  addDays, formatDateShort, formatDuration, formatShiftRange, formatWeekRange, weekDates, weekStartOf,
} from '../../../shared/teams/time'
import { availabilityOn, availabilityProblem, timeOffClash } from '../../../shared/teams/availability'
import { Badge, Banner, Button, Card, Divider, SkeletonCard, Text } from '../ui/components'
import { useTheme } from '../ui/theme'

// The manager's week: build it shift by shift, then publish it to the team.
// `week` opens a given week, as after an import; `imported` says how many
// shifts that import added, and `weeks` (comma-separated) which weeks.
export default function ScheduleManager({ week, imported, weeks }) {
  const router = useRouter()
  const t = useTheme()
  const today = useToday()
  const { activeId, fromHengam } = useWorkspace()
  const [weekStart, setWeekStart] = useState(() => week || weekStartOf(today))
  const { schedule, shifts, loading, error } = useWeekSchedule(weekStart)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [notice, setNotice] = useState(null)
  const importedWeeks = typeof weeks === 'string' && weeks ? weeks.split(',') : []
  // Select mode: tap shifts (or a whole day) to delete many at once.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toggle = (ids, on) => setSelected(prev => {
    const next = new Set(prev)
    ids.forEach(id => (on ? next.add(id) : next.delete(id)))
    return next
  })
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); setConfirmDelete(false) }
  const goToWeek = (w) => { setWeekStart(w); setConfirm(false); stopSelecting() }

  const availability = useTeamAvailability()
  const timeOff = useTeamTimeOff(weekStart)

  // For each shift, why it may not suit the person working it: time off,
  // pending or approved, or hours outside what they said they can work.
  const concerns = useMemo(() => {
    const out = {}
    for (const s of shifts || []) {
      const off = (timeOff || []).find(r => r.staffId === s.staffId && timeOffClash(s, r))
      const outside = availabilityProblem(s, availability?.[s.staffId])
      if (off) out[s.id] = `${s.staffName} ${off.status === 'approved' ? 'has time off' : 'has asked for time off'} then`
      else if (outside) out[s.id] = `${s.staffName} ${outside}`
    }
    return out
  }, [shifts, timeOff, availability])

  // Who is off on each day, so the gaps are visible before adding a shift.
  const offOn = (date) => {
    const names = new Set()
    for (const r of timeOff || []) if (r.status === 'approved' && r.startDate <= date && r.endDate >= date) names.add(r.staffName)
    for (const a of Object.values(availability || {})) {
      const day = availabilityOn(a, date)
      if (day && !day.available) names.add(a.staffName)
    }
    return [...names]
  }

  const byDate = useMemo(() => {
    const map = {}
    for (const s of shifts || []) (map[s.date] ||= []).push(s)
    return map
  }, [shifts])

  const published = schedule?.status === 'published'
  const count = shifts?.length || 0
  const minutes = (shifts || []).reduce((sum, s) => sum + (s.minutes || 0), 0)
  const people = new Set((shifts || []).map(s => s.staffId)).size

  // A bi-weekly or monthly import, published in one go. A week already live
  // publishes nothing; each is still its own publish, as the team hears per week.
  async function publishWeeks(list) {
    setBusy(true)
    setNotice(null)
    let shiftsOut = 0
    const failed = []
    for (const w of list) {
      try {
        const result = await callTeams('publishSchedule', { bizId: activeId, weekStart: w })
        shiftsOut += result.published || 0
      } catch (err) {
        failed.push(`${formatWeekRange(w)}: ${err instanceof ApiError ? err.message : 'could not publish'}`)
      }
    }
    setBusy(false)
    setNotice(failed.length
      ? { tone: 'danger', message: `Published ${shiftsOut} shifts, but not every week. ${failed.join(' ')}` }
      : { tone: 'success', message: `Published ${shiftsOut} shifts across ${list.length} weeks. Your team can see them now.` })
  }

  async function deleteSelected() {
    setBusy(true)
    setNotice(null)
    try {
      const r = await callTeams('deleteShifts', { bizId: activeId, shiftIds: [...selected] })
      setNotice({ tone: 'success', message: `Deleted ${r.removed} ${r.removed === 1 ? 'shift' : 'shifts'}.` })
      stopSelecting()
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not delete those shifts.' })
    } finally {
      setBusy(false)
    }
  }

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
        <IconButton icon="chevron-left" label="Previous week" onPress={() => goToWeek(addDays(weekStart, -7))} />
        <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <Text variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite">{formatWeekRange(weekStart)}</Text>
          {!loading ? (
            <Badge label={!schedule ? 'Not started' : published ? 'Published' : 'Draft'} tone={published ? 'success' : schedule ? 'warning' : 'neutral'} />
          ) : null}
        </View>
        <IconButton icon="chevron-right" label="Next week" onPress={() => goToWeek(addDays(weekStart, 7))} />
      </View>

      <Banner message={error} />
      <Banner tone={notice?.tone} message={notice?.message} />
      {imported && !notice ? (
        <Card style={{ gap: 10 }}>
          <Text>
            {importedWeeks.length > 1
              ? `${imported} imported shifts are in ${importedWeeks.length} weeks, ${formatWeekRange(importedWeeks[0])} to ${formatWeekRange(importedWeeks.at(-1))}. They’re drafts until you publish.`
              : `${imported} imported ${Number(imported) === 1 ? 'shift is' : 'shifts are'} here as a draft. Check them, then publish.`}
          </Text>
          {importedWeeks.length > 1 ? (
            <Button title={`Publish all ${importedWeeks.length} weeks`} icon="send" loading={busy}
              onPress={() => publishWeeks(importedWeeks)} />
          ) : null}
        </Card>
      ) : null}

      {loading ? <><SkeletonCard lines={2} /><SkeletonCard lines={2} /></> : (
        <>
          <Card style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <Stat label="Shifts" value={String(count)} />
            <Stat label="Hours" value={minutes ? formatDuration(minutes) : '0h'} />
            <Stat label="People" value={String(people)} />
          </Card>

          {!fromHengam ? <PendingImports onImport={() => router.push('/import-new')} onOpen={(id) => router.push(`/import/${id}`)}
            onHistory={() => router.push('/imports')} /> : null}
          {fromHengam ? (
            <Banner tone="info" message="This schedule comes from Hengam. Change it there and publish it again; pickups and swaps approved here are written back to Hengam." />
          ) : published ? (
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

          {!fromHengam && count ? (
            selecting ? (
              <Card style={{ gap: 10, borderColor: t.color.accent }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="label" style={{ flex: 1 }} accessibilityLiveRegion="polite">
                    {selected.size ? `${selected.size} ${selected.size === 1 ? 'shift' : 'shifts'} selected` : 'Tap shifts to select them'}
                  </Text>
                  <Button title="Cancel" variant="ghost" style={{ minHeight: 36, paddingHorizontal: 8 }} onPress={stopSelecting} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title={`Select all ${count}`} variant="secondary" style={{ flex: 1, minHeight: 40 }}
                    onPress={() => toggle((shifts || []).map(s => s.id), true)} />
                  <Button title="Clear" variant="secondary" style={{ flex: 1, minHeight: 40 }} disabled={!selected.size}
                    onPress={() => setSelected(new Set())} />
                </View>
                {confirmDelete ? (
                  <View style={{ gap: 8 }}>
                    <Text>
                      Delete {selected.size} {selected.size === 1 ? 'shift' : 'shifts'}?
                      {(() => {
                        const live = (shifts || []).filter(s => selected.has(s.id) && s.published).length
                        return live ? ` ${live} ${live === 1 ? 'is' : 'are'} published, so the people working ${live === 1 ? 'it' : 'them'} will be told.` : ''
                      })()}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button title="Delete" variant="danger" icon="trash-2" loading={busy} style={{ flex: 1 }} onPress={deleteSelected} />
                      <Button title="Keep" variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmDelete(false)} />
                    </View>
                  </View>
                ) : (
                  <Button title={selected.size ? `Delete ${selected.size} ${selected.size === 1 ? 'shift' : 'shifts'}` : 'Delete'}
                    variant="danger" icon="trash-2" disabled={!selected.size} onPress={() => setConfirmDelete(true)} />
                )}
              </Card>
            ) : (
              <Button title="Select shifts" variant="ghost" icon="check-square" onPress={() => { setNotice(null); setSelecting(true) }} />
            )
          ) : null}

          {weekDates(weekStart).map(date => (
            <Card key={date} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="label" style={date === today ? { color: t.color.accent } : null} accessibilityRole="header">
                  {formatDateShort(date)}{date === today ? ' · Today' : ''}
                </Text>
                {fromHengam ? null : selecting ? (() => {
                  const ids = (byDate[date] || []).map(s => s.id)
                  if (!ids.length) return null
                  const all = ids.every(id => selected.has(id))
                  return (
                    <Pressable onPress={() => toggle(ids, !all)} accessibilityRole="button"
                      accessibilityLabel={`${all ? 'Unselect' : 'Select'} every shift on ${formatDateShort(date)}`}
                      hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 6 }}>
                      <Feather name={all ? 'check-square' : 'square'} size={16} color={t.color.accent} />
                      <Text variant="label" tone="accent">{all ? 'Unselect day' : 'Select day'}</Text>
                    </Pressable>
                  )
                })() : <Pressable onPress={() => add(date)} accessibilityRole="button" accessibilityLabel={`Add a shift on ${formatDateShort(date)}`}
                  hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 6 }}>
                  <Feather name="plus" size={16} color={t.color.accent} />
                  <Text variant="label" tone="accent">Add</Text>
                </Pressable>}
              </View>
              {offOn(date).length ? (
                <Text variant="caption" tone="muted">Off or unavailable: {offOn(date).join(', ')}</Text>
              ) : null}
              {(byDate[date] || []).length ? (byDate[date]).map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable onPress={() => (selecting ? toggle([s.id], !selected.has(s.id))
                    : router.push(fromHengam ? `/shift/${activeId}/${s.id}` : { pathname: '/shift-edit', params: { shiftId: s.id } }))}
                    accessibilityRole={selecting ? 'checkbox' : 'button'}
                    aria-checked={selecting ? selected.has(s.id) : undefined}
                    accessibilityLabel={`${s.staffName}, ${formatShiftRange(s)}${s.positionName ? `, ${s.positionName}` : ''}${concerns[s.id] ? `. Warning: ${concerns[s.id]}` : ''}${selecting ? '' : '. Edit'}`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: pressed ? 0.7 : 1,
                      ...(selecting && selected.has(s.id) ? { backgroundColor: t.color.accentBg, borderRadius: t.radius.sm, paddingHorizontal: 6 } : null) })}>
                    {selecting ? <Feather name={selected.has(s.id) ? 'check-square' : 'square'} size={20} color={selected.has(s.id) ? t.color.accent : t.color.textFaint} /> : null}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={1}>{s.staffName}</Text>
                      <Text variant="caption" tone="muted">
                        {formatShiftRange(s)} · {formatDuration(s.minutes)}{s.positionName ? ` · ${s.positionName}` : ''}
                      </Text>
                      {concerns[s.id] ? <Text variant="caption" style={{ color: t.color.warning }}>⚠ {concerns[s.id]}</Text> : null}
                    </View>
                    {!s.assigneeUid ? <Badge label="No account" tone="neutral" /> : null}
                    {selecting ? null : <Feather name="chevron-right" size={16} color={t.color.textFaint} />}
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

// Imports read but not yet reviewed, and the way to start a new one.
function PendingImports({ onImport, onOpen, onHistory }) {
  const { activeId } = useWorkspace()
  const [state, setState] = useState({ key: null, items: [] })
  useEffect(() => {
    if (!activeId) return undefined
    return onSnapshot(query(collection(db, 'businesses', activeId, 'imports'), where('status', '==', 'review')),
      (snap) => setState({ key: activeId, items: snap.docs.map(d => ({ id: d.id, ...d.data() })) }),
      () => setState({ key: activeId, items: [] }))
  }, [activeId])
  const items = state.key === activeId ? state.items : []
  return (
    <View style={{ gap: 8 }}>
      {items.map(i => (
        <Card key={i.id} onPress={() => onOpen(i.id)} accessibilityLabel={`Import ${i.fileName}, waiting for review`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{i.fileName}</Text>
            <Badge label="Review" tone="warning" />
          </View>
          <Text variant="caption" tone="muted">{i.rows?.length || 0} shifts read. Nothing is added until you review it.</Text>
        </Card>
      ))}
      <Button title="Import a schedule" icon="upload" variant="secondary" onPress={onImport} />
      <Button title="Past imports and where they went" variant="ghost" onPress={onHistory} />
    </View>
  )
}
