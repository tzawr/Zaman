import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { ApiError, callTeams } from '../lib/api'
import { db } from '../lib/firebase'
import { useWorkspace } from '../state/workspace'
import { formatDateShort, formatWeekRange } from '../../../shared/teams/time'
import { Badge, Banner, Button, Card, EmptyState, Screen, SkeletonCard, Text } from '../ui/components'

// Every schedule imported here, newest first, and where its shifts went: an
// applied import lists the weeks it filled, each a tap away.
export default function Imports() {
  const router = useRouter()
  const { activeId } = useWorkspace()
  const [state, setState] = useState({ key: null, items: null, error: null })

  useEffect(() => {
    if (!activeId) return undefined
    return onSnapshot(query(collection(db, 'businesses', activeId, 'imports'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => setState({ key: activeId, items: snap.docs.map(d => ({ id: d.id, ...d.data() })), error: null }),
      () => setState({ key: activeId, items: [], error: 'Could not load your imports.' }))
  }, [activeId])
  const items = state.key === activeId ? state.items : null

  if (!items) return <Screen><SkeletonCard lines={2} /><SkeletonCard lines={2} /></Screen>
  return (
    <Screen>
      <Banner message={state.error} />
      {!items.length ? (
        <EmptyState icon="upload" title="No imports yet" message="Schedules you import show up here, with the weeks they went into."
          action={<Button title="Import a schedule" onPress={() => router.replace('/import-new')} />} />
      ) : items.map(item => (
        <ImportCard key={item.id} item={item} bizId={activeId}
          onOpenWeek={(week) => router.replace({ pathname: '/manage', params: { week } })}
          onReview={() => router.push(`/import/${item.id}`)} />
      ))}
    </Screen>
  )
}

function ImportCard({ item, bizId, onOpenWeek, onReview }) {
  async function undo() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await callTeams('undoImport', { bizId, importId: item.id })
      setMessage({ tone: 'success', message: `Removed ${r.removed} ${r.removed === 1 ? 'shift' : 'shifts'}. You can import the right file now.` })
    } catch (err) {
      setMessage({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not undo this import.' })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const weeks = useImportWeeks(bizId, item)
  // The day it was imported where the manager is, not in UTC.
  const at = item.createdAt?.toDate?.()
  const added = at ? formatDateShort(`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`) : ''
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const status = { review: ['Waiting for review', 'warning'], published: ['Added', 'success'], discarded: ['Discarded', 'neutral'], undone: ['Undone', 'neutral'] }[item.status]
    || [item.status, 'neutral']

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{item.fileName}</Text>
        <Badge label={status[0]} tone={status[1]} />
      </View>
      <Text variant="caption" tone="muted">
        {added ? `Imported ${added} · ` : ''}{item.status === 'published'
          ? `${item.shiftsCreated ?? 0} ${item.shiftsCreated === 1 ? 'shift' : 'shifts'} added`
          : item.status === 'undone'
            ? `${item.shiftsRemoved ?? 0} ${item.shiftsRemoved === 1 ? 'shift' : 'shifts'} removed`
            : `${item.rows?.length || 0} shifts read`}
      </Text>
      <Banner tone={message?.tone} message={message?.message} />
      {item.status === 'review' ? <Button title="Review and add" variant="secondary" onPress={onReview} /> : null}
      {item.status === 'published' ? (
        weeks === null ? <Text variant="caption" tone="faint">Finding its weeks…</Text>
          : weeks.length ? (
            <View style={{ gap: 6 }}>
              {weeks.map(w => (
                <Button key={w.week} title={`${formatWeekRange(w.week)}${w.count === null ? '' : ` · ${w.count} ${w.count === 1 ? 'shift' : 'shifts'}`}`}
                  variant="secondary" icon="calendar" onPress={() => onOpenWeek(w.week)} />
              ))}
            </View>
          ) : <Banner tone="warning" message="None of this import’s shifts are on the schedule any more. They may have been deleted." />
      ) : null}
      {item.status === 'published' ? (
        confirming ? (
          <View style={{ gap: 8 }}>
            <Text>Remove the {item.shiftsCreated ?? ''} shifts this import added? Weeks you have published can’t be undone this way.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Remove them" variant="danger" loading={busy} style={{ flex: 1 }} onPress={undo} />
              <Button title="Keep" variant="secondary" style={{ flex: 1 }} onPress={() => setConfirming(false)} />
            </View>
          </View>
        ) : <Button title="Undo this import" variant="ghost" icon="rotate-ccw" onPress={() => setConfirming(true)} />
      ) : null}
    </Card>
  )
}

// The weeks an applied import's shifts are in, counted from the shifts
// themselves, so it also works for imports made before weeks were recorded
// and shows what is there now.
function useImportWeeks(bizId, item) {
  const [weeks, setWeeks] = useState({ key: null, list: null })
  const key = `${bizId}/${item.id}/${item.status}`
  useEffect(() => {
    if (item.status !== 'published') return
    let live = true
    getDocs(query(collection(db, 'businesses', bizId, 'shifts'), where('importId', '==', item.id)))
      .then((snap) => {
        const counts = {}
        snap.docs.forEach(d => { const w = d.data().scheduleId; counts[w] = (counts[w] || 0) + 1 })
        if (live) setWeeks({ key, list: Object.keys(counts).sort().map(week => ({ week, count: counts[week] })) })
      })
      // Unable to count: the weeks recorded at the time, without counts.
      .catch(() => { if (live) setWeeks({ key, list: (item.weeks || []).map(week => ({ week, count: null })) }) })
    return () => { live = false }
  }, [bizId, item.id, item.status, item.weeks, key])
  return weeks.key === key ? weeks.list : null
}
