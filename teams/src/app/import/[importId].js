import { useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, Switch, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { doc, onSnapshot } from 'firebase/firestore'
import { ApiError, callTeams } from '../../lib/api'
import { db } from '../../lib/firebase'
import { useStaff } from '../../state/shifts'
import { useWorkspace } from '../../state/workspace'
import { importPeople, rowIssues, rowWarnings } from '../../../../shared/teams/imports'
import { formatDateShort, isDateString, normalizeTimeInput, weekStartOf } from '../../../../shared/teams/time'
import { Banner, Button, Card, Divider, Screen, SkeletonCard, Text, TextField } from '../../ui/components'
import { useTheme } from '../../ui/theme'

// Reviewing an import. What was read is shown as a schedule, people are
// decided once each (anyone new is added), and the one button adds it all as
// a draft. Only a shift with no person, date or times holds it back; what the
// file left uncertain is shown, not demanded.
export default function ImportReview() {
  const t = useTheme()
  const router = useRouter()
  const importId = String(useLocalSearchParams().importId)
  const { activeId } = useWorkspace()
  const staff = useStaff()
  const [job, setJob] = useState({ key: null, data: undefined })
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [openRow, setOpenRow] = useState(null)
  const [showWarnings, setShowWarnings] = useState(false)
  const key = `${activeId}/${importId}`

  useEffect(() => {
    if (!activeId) return undefined
    return onSnapshot(doc(db, 'businesses', activeId, 'imports', importId),
      (snap) => setJob({ key, data: snap.exists() ? snap.data() : null }),
      () => setJob({ key, data: null }))
  }, [activeId, importId, key])
  const data = job.key === key ? job.data : undefined

  // The manager's working copy, started from what was read.
  const working = useMemo(() => rows ?? data?.rows ?? [], [rows, data])
  const checked = useMemo(() => working.map(r => ({
    ...r, issues: r.include ? rowIssues(r) : [], warnings: r.include ? rowWarnings(r) : [],
  })), [working])
  const included = checked.filter(r => r.include)
  const blocked = included.filter(r => r.issues.length)
  const unsure = included.filter(r => !r.issues.length && r.warnings.length)
  const people = useMemo(() => importPeople(working), [working])
  const dates = [...new Set(included.map(r => r.date).filter(Boolean))].sort()

  const update = (id, patch) => setRows(working.map(r => (r.id === id ? { ...r, ...patch } : r)))
  // A decision about a person applies to every shift with their name.
  const updatePerson = (name, patch) => setRows(working.map(r => (r.name === name ? { ...r, ...patch } : r)))

  async function apply() {
    setBusy('apply')
    setError(null)
    try {
      const result = await callTeams('applyImport', { bizId: activeId, importId, rows: working })
      // Straight to the week the shifts went into, where they are published.
      const weeks = [...(result.weeks || [])].sort()
      router.replace({ pathname: '/manage', params: { week: weeks[0], imported: String(result.created), weeks: weeks.join(',') } })
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, problems: err.problems } : { message: 'Could not add these shifts.' })
      setBusy(null)
    }
  }

  async function discard() {
    setBusy('discard')
    try {
      await callTeams('discardImport', { bizId: activeId, importId })
      router.back()
    } catch {
      setBusy(null)
    }
  }

  if (data === undefined || staff === null) return <Screen><SkeletonCard lines={3} /><SkeletonCard lines={3} /></Screen>
  if (!data) return <Screen><Banner tone="info" message="This import no longer exists." /></Screen>
  if (data.status !== 'review') {
    return (
      <Screen>
        <Banner tone="info" message={data.status === 'published' ? `This import was added: ${data.shiftsCreated} shifts.` : 'This import was discarded.'} />
        {data.status === 'published' && data.week
          ? <Button title="Open that week" onPress={() => router.replace({ pathname: '/manage', params: { week: weekStartOf(data.week) } })} />
          : null}
      </Screen>
    )
  }

  const range = dates.length ? (dates.length === 1 ? formatDateShort(dates[0]) : `${formatDateShort(dates[0])} – ${formatDateShort(dates.at(-1))}`) : ''
  const peopleCount = people.filter(p => p.included).length
  const byDate = {}
  checked.forEach(r => { (byDate[r.date || 'none'] ||= []).push(r) })
  const dayKeys = Object.keys(byDate).sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : a.localeCompare(b)))
  const editor = (r) => (openRow === r.id || r.issues.length
    ? <RowEditor key={r.id} row={r} staff={staff} onChange={(patch) => update(r.id, patch)} onDone={r.issues.length ? null : () => setOpenRow(null)} />
    : null)

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <View style={{ gap: 4 }}>
          <Text variant="heading" accessibilityRole="header">
            {included.length} {included.length === 1 ? 'shift' : 'shifts'} for {peopleCount} {peopleCount === 1 ? 'person' : 'people'}
          </Text>
          <Text tone="muted">{range ? `${range} · ` : ''}from {data.fileName}</Text>
        </View>
        {data.notes ? <Banner tone="info" message={`From the reader: ${data.notes}`} /> : null}

        {blocked.length ? (
          <View style={{ gap: 8 }}>
            <SectionLabel icon="alert-circle" tone="warning">
              {blocked.length} {blocked.length === 1 ? 'shift needs' : 'shifts need'} you before adding
            </SectionLabel>
            {blocked.map(editor)}
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <SectionLabel icon="users">People</SectionLabel>
          <Card style={{ paddingVertical: 4, gap: 0 }}>
            {people.map((p, i) => (
              <View key={p.name}>
                {i > 0 ? <Divider /> : null}
                <PersonRow person={p} staff={staff} onChange={(patch) => updatePerson(p.name, patch)} />
              </View>
            ))}
          </Card>
        </View>

        {unsure.length ? (
          <Card style={{ gap: 8 }}>
            <Pressable onPress={() => setShowWarnings(!showWarnings)} accessibilityRole="button"
              aria-expanded={showWarnings} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
              <Feather name="eye" size={16} color={t.color.textMuted} />
              <Text style={{ flex: 1 }}>
                {unsure.length} {unsure.length === 1 ? 'shift was' : 'shifts were'} read with a guess. Worth a look.
              </Text>
              <Feather name={showWarnings ? 'chevron-up' : 'chevron-down'} size={18} color={t.color.textFaint} />
            </Pressable>
            {showWarnings ? unsure.map(r => (
              <View key={r.id}>
                <Pressable onPress={() => setOpenRow(openRow === r.id ? null : r.id)} accessibilityRole="button"
                  accessibilityLabel={`${r.name}, ${r.date ? formatDateShort(r.date) : 'no date'}, ${r.start} to ${r.end}. ${r.warnings.join(' ')} Edit`}
                  style={{ minHeight: 40, justifyContent: 'center' }}>
                  <Text variant="caption">{r.name} · {r.date ? formatDateShort(r.date) : 'no date'} · {r.start}–{r.end}</Text>
                  <Text variant="caption" tone="faint">{r.warnings.join(' ')}{r.raw ? ` Read from “${r.raw}”.` : ''}</Text>
                </Pressable>
                {editor(r)}
              </View>
            )) : null}
          </Card>
        ) : null}

        <View style={{ gap: 8 }}>
          <SectionLabel icon="calendar">Schedule</SectionLabel>
          {dayKeys.map(day => (
            <Card key={day} style={{ gap: 6 }}>
              <Text variant="label">{day === 'none' ? 'No date' : formatDateShort(day)}</Text>
              {byDate[day].map(r => (
                <View key={r.id}>
                  <Pressable onPress={() => setOpenRow(openRow === r.id ? null : r.id)} accessibilityRole="button"
                    accessibilityLabel={`${r.name}, ${r.start || 'no start'} to ${r.end || 'no end'}${r.include ? '' : ', left out'}. Edit`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32, opacity: r.include ? 1 : 0.45 }}>
                    <Text style={{ flex: 1 }} numberOfLines={1}>{r.name}</Text>
                    <Text tone={r.issues.length ? 'danger' : 'muted'}>{r.start && r.end ? `${r.start}–${r.end}` : 'No times'}</Text>
                    {r.warnings.length ? <Feather name="eye" size={14} color={t.color.textFaint} /> : null}
                  </Pressable>
                  {r.issues.length ? null : editor(r)}
                </View>
              ))}
            </Card>
          ))}
        </View>
      </Screen>
      <Footer>
        {error ? <Banner message={[error.message, ...(error.problems || []).slice(0, 5).map(p => p.message)].join('\n')} /> : null}
        <Button title={blocked.length ? `Fix ${blocked.length} ${blocked.length === 1 ? 'shift' : 'shifts'} above to continue` : `Add ${included.length} shifts to the schedule`}
          disabled={Boolean(blocked.length) || !included.length || Boolean(busy)} loading={busy === 'apply'} onPress={apply} />
        <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>
          They’re added as a draft. Nobody sees them until you publish.
        </Text>
        <Button title="Discard this import" variant="ghost" loading={busy === 'discard'} onPress={discard} />
      </Footer>
    </View>
  )
}

function SectionLabel({ icon, tone, children }) {
  const t = useTheme()
  const color = tone === 'warning' ? t.color.warning : t.color.textMuted
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <Feather name={icon} size={15} color={color} />
      <Text variant="label" style={{ color }} accessibilityRole="header">{children}</Text>
    </View>
  )
}

function Footer({ children }) {
  const t = useTheme()
  return (
    <View style={{ borderTopWidth: 1, borderColor: t.color.border, backgroundColor: t.color.surface, padding: 16, gap: 8 }}>
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 8 }}>{children}</View>
    </View>
  )
}

// One name from the file, and who it will be on the team.
function PersonRow({ person, staff, onChange }) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const member = staff.find(s => s.id === person.staffId)
  const out = person.included === 0
  const status = out ? 'Left out'
    : person.staffId === 'new' ? 'New to your team · added with the import'
      : member ? (person.name === member.name ? 'On your team' : `Matched to ${member.name}`)
        : person.match === 'ambiguous' ? 'More than one person has this name' : 'Pick who this is'
  const needsPick = !out && !person.staffId
  const pick = (patch) => { onChange(patch); setOpen(false) }

  return (
    <View style={{ paddingVertical: 8, gap: 8 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" aria-expanded={open} accessibilityLabel={`${person.name}: ${status}. Change`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, opacity: out ? 0.5 : 1 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" numberOfLines={1}>{person.name}</Text>
          <Text variant="caption" tone={needsPick ? 'danger' : 'muted'}>{status}</Text>
        </View>
        <Text variant="caption" tone="muted">{person.count} {person.count === 1 ? 'shift' : 'shifts'}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.color.textFaint} />
      </Pressable>
      {open || needsPick ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {staff.filter(s => !s.archived).map(s => (
            <Chip key={s.id} label={s.name} selected={s.id === person.staffId && !out}
              onPress={() => pick({ staffId: s.id, match: 'exact', include: true })} />
          ))}
          <Chip label={`New: ${person.name}`} selected={person.staffId === 'new' && !out}
            onPress={() => pick({ staffId: 'new', match: 'new', include: true })} />
          <Chip label={out ? 'Include again' : 'Leave out'} onPress={() => pick({ include: out })} />
        </ScrollView>
      ) : null}
    </View>
  )
}

// One shift, editable: when it is, or whether it is in at all.
function RowEditor({ row, staff, onChange, onDone }) {
  const t = useTheme()
  const person = row.staffId === 'new' ? null : staff.find(s => s.id === row.staffId)
  return (
    <Card style={{ gap: 10, borderColor: row.issues.length ? t.color.warning : t.color.border, marginTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{person?.name || row.name}</Text>
        <Text variant="caption" tone="muted">Include</Text>
        <Switch value={row.include} onValueChange={(v) => onChange({ include: v })}
          accessibilityLabel={`Include ${row.name} on ${row.date || 'no date'}`} trackColor={{ true: t.color.accent }} />
      </View>
      {row.include ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextField style={{ flex: 1.4 }} label="Date" value={row.date || ''} placeholder="YYYY-MM-DD" autoCapitalize="none"
              onChangeText={(v) => onChange({ date: isDateString(v.trim()) ? v.trim() : v, confirmed: true })} />
            <TextField style={{ flex: 1 }} label="Start" value={row.start || ''} placeholder="09:00" autoCapitalize="none"
              onChangeText={(v) => onChange({ start: v })} onBlur={() => onChange({ start: normalizeTimeInput(row.start || '') || row.start, confirmed: true })} />
            <TextField style={{ flex: 1 }} label="End" value={row.end || ''} placeholder="17:00" autoCapitalize="none"
              onChangeText={(v) => onChange({ end: v })} onBlur={() => onChange({ end: normalizeTimeInput(row.end || '') || row.end, confirmed: true })} />
          </View>
          {row.raw ? <Text variant="caption" tone="faint">In the file: “{row.raw}”</Text> : null}
          {row.issues.map((issue, i) => <Text key={i} variant="caption" style={{ color: t.color.warning }}>{issue}</Text>)}
        </>
      ) : null}
      {onDone ? <Button title="Done" variant="secondary" style={{ minHeight: 40 }} onPress={() => { onChange({ confirmed: true }); onDone() }} /> : null}
    </Card>
  )
}

function Chip({ label, selected, onPress }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={selected ? `${label}, chosen` : label}
      style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: 1,
        borderColor: selected ? t.color.accent : t.color.border, backgroundColor: selected ? t.color.accentBg : t.color.elevated }}>
      <Text variant="label" style={selected ? { color: t.color.accent } : null}>{label}</Text>
    </Pressable>
  )
}
