import { useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, Switch, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { doc, onSnapshot } from 'firebase/firestore'
import { ApiError, callTeams } from '../../lib/api'
import { db } from '../../lib/firebase'
import { useStaff } from '../../state/shifts'
import { useWorkspace } from '../../state/workspace'
import { rowIssues } from '../../../../shared/teams/imports'
import { formatDateShort, formatWeekRange, isDateString, normalizeTimeInput } from '../../../../shared/teams/time'
import { Badge, Banner, Button, Card, EmptyState, Screen, SkeletonCard, Text, TextField } from '../../ui/components'
import { useTheme } from '../../ui/theme'

// Reviewing an import, row by row. A row needs a person, a date and times,
// and anything the file left unclear confirmed. Only then can it be added,
// and it is added as a draft.
export default function ImportReview() {
  const router = useRouter()
  const importId = String(useLocalSearchParams().importId)
  const { activeId } = useWorkspace()
  const staff = useStaff()
  const [job, setJob] = useState({ key: null, data: undefined })
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const key = `${activeId}/${importId}`

  useEffect(() => {
    if (!activeId) return undefined
    return onSnapshot(doc(db, 'businesses', activeId, 'imports', importId),
      (snap) => setJob({ key, data: snap.exists() ? snap.data() : null }),
      () => setJob({ key, data: null }))
  }, [activeId, importId, key])
  const data = job.key === key ? job.data : undefined

  // The manager's working copy, started from what was read.
  const working = rows ?? data?.rows ?? null
  const withIssues = useMemo(() => (working || []).map(r => ({ ...r, issues: r.include ? rowIssues(r) : [] })), [working])
  const included = withIssues.filter(r => r.include)
  const blocked = included.filter(r => r.issues.length)

  const update = (id, patch) => setRows((working || []).map(r => (r.id === id ? { ...r, ...patch } : r)))

  async function apply() {
    setBusy('apply')
    setError(null)
    try {
      setResult(await callTeams('applyImport', { bizId: activeId, importId, rows: working }))
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, problems: err.problems } : { message: 'Could not add these shifts.' })
    } finally {
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
  if (result) {
    return (
      <Screen>
        <EmptyState icon="check-circle" title={`${result.created} shifts added as a draft`}
          message={`${result.newPeople ? `${result.newPeople} new ${result.newPeople === 1 ? 'person was' : 'people were'} added to your team. ` : ''}Check the week in Manage, then publish it when you’re ready.`}
          action={<Button title="Open the schedule" onPress={() => router.replace('/manage')} />} />
      </Screen>
    )
  }
  if (data.status !== 'review') {
    return <Screen><Banner tone="info" message={data.status === 'published' ? `This import was added: ${data.shiftsCreated} shifts.` : 'This import was discarded.'} /></Screen>
  }

  const byDate = {}
  withIssues.forEach(r => { (byDate[r.date || 'none'] ||= []).push(r) })
  const dates = Object.keys(byDate).sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : a.localeCompare(b)))

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Text variant="heading">{data.fileName}</Text>
        <Text tone="muted">
          {withIssues.length} {withIssues.length === 1 ? 'shift' : 'shifts'} read{data.week ? ` for ${formatWeekRange(data.week)}` : ''}.
          {blocked.length ? ` ${blocked.length} need your attention.` : ' Everything checks out.'}
        </Text>
        {data.notes ? <Banner tone="warning" message={`From the reader: ${data.notes}`} /> : null}
        {dates.map(date => (
          <View key={date} style={{ gap: 8 }}>
            <Text variant="label" tone="muted" accessibilityRole="header">{date === 'none' ? 'No date' : formatDateShort(date)}</Text>
            {byDate[date].map(r => <RowCard key={r.id} row={r} staff={staff} onChange={(patch) => update(r.id, patch)} />)}
          </View>
        ))}
      </Screen>
      <Footer>
        {error ? <Banner message={[error.message, ...(error.problems || []).slice(0, 5).map(p => p.message)].join('\n')} /> : null}
        <Button title={blocked.length ? `${blocked.length} ${blocked.length === 1 ? 'row needs' : 'rows need'} attention` : `Add ${included.length} shifts as a draft`}
          disabled={Boolean(blocked.length) || !included.length || Boolean(busy)} loading={busy === 'apply'} onPress={apply} />
        <Button title="Discard this import" variant="ghost" loading={busy === 'discard'} onPress={discard} />
      </Footer>
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

function RowCard({ row, staff, onChange }) {
  const t = useTheme()
  const [picking, setPicking] = useState(false)
  const person = staff.find(s => s.id === row.staffId)
  const unclear = !row.confirmed && (!row.sure?.date || !row.sure?.times || !row.sure?.name)
  const choose = (staffId) => { onChange({ staffId, match: 'exact', confirmed: row.confirmed || !unclear }); setPicking(false) }

  return (
    <Card style={{ opacity: row.include ? 1 : 0.55, borderColor: row.issues.length ? t.color.warning : t.color.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="faint">In the file: “{row.name}”</Text>
          {row.staffId === 'new' ? <Text variant="label">{row.name} · new to your team</Text>
            : person ? <Text variant="label">{person.name}{row.match === 'suggested' ? '?' : ''}</Text>
              : <Text variant="label" tone="danger">Who is this?</Text>}
        </View>
        <Switch value={row.include} onValueChange={(v) => onChange({ include: v })}
          accessibilityLabel={`Include ${row.name} on ${row.date || 'no date'}`} trackColor={{ true: t.color.accent }} />
      </View>

      {row.include ? (
        <>
          {row.match === 'suggested' && !row.confirmed && person ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title={`Yes, ${person.name.split(' ')[0]}`} variant="secondary" style={{ flex: 1, minHeight: 40 }}
                onPress={() => onChange({ match: 'exact', confirmed: !unclear || row.confirmed })} />
              <Button title="Someone else" variant="ghost" style={{ flex: 1, minHeight: 40 }} onPress={() => setPicking(true)} />
            </View>
          ) : null}
          {(!row.staffId || picking) ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {staff.filter(s => !s.archived).map(s => <Chip key={s.id} label={s.name} onPress={() => choose(s.id)} />)}
              <Chip label={`+ Add “${row.name}”`} onPress={() => { onChange({ staffId: 'new', match: 'exact' }); setPicking(false) }} />
            </ScrollView>
          ) : row.match === 'suggested' && !row.confirmed ? null : (
            <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Change who works this shift" hitSlop={6}>
              <Text variant="caption" tone="accent">Change person</Text>
            </Pressable>
          )}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextField style={{ flex: 1.4 }} label="Date" value={row.date || ''} placeholder="YYYY-MM-DD" autoCapitalize="none"
              onChangeText={(v) => onChange({ date: isDateString(v.trim()) ? v.trim() : v, confirmed: true })} />
            <TextField style={{ flex: 1 }} label="Start" value={row.start || ''} autoCapitalize="none"
              onChangeText={(v) => onChange({ start: v })} onBlur={() => onChange({ start: normalizeTimeInput(row.start || '') || row.start, confirmed: true })} />
            <TextField style={{ flex: 1 }} label="End" value={row.end || ''} autoCapitalize="none"
              onChangeText={(v) => onChange({ end: v })} onBlur={() => onChange({ end: normalizeTimeInput(row.end || '') || row.end, confirmed: true })} />
          </View>
          {row.positionName ? <View style={{ alignSelf: 'flex-start' }}><Badge label={row.positionName} tone="neutral" /></View> : null}
          {row.raw ? <Text variant="caption" tone="faint">Read from: {row.raw}</Text> : null}

          {row.issues.map((issue, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <Feather name="alert-circle" size={14} color={t.color.warning} style={{ marginTop: 2 }} />
              <Text variant="caption" style={{ color: t.color.warning, flex: 1 }}>{issue}</Text>
            </View>
          ))}
          {unclear && row.staffId && row.date && row.start && row.end ? (
            <Button title="These details are right" variant="secondary" style={{ minHeight: 40 }} onPress={() => onChange({ confirmed: true, match: row.match === 'suggested' ? 'exact' : row.match })} />
          ) : null}
        </>
      ) : null}
    </Card>
  )
}

function Chip({ label, onPress }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.color.border, backgroundColor: t.color.elevated }}>
      <Text variant="label">{label}</Text>
    </Pressable>
  )
}
