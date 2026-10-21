import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { DEFAULT_POLICIES, TIME_OFF_CATEGORIES } from '../../../shared/teams/schema'
import { TIME_OFF_LABELS } from '../../../shared/teams/availability'
import { db } from '../lib/firebase'
import { useAuth } from './auth'
import { useWorkspace } from './workspace'

// Live availability, time off and policy data for the current workplace.

function useLive(key, build, map) {
  const [state, setState] = useState({ key: null, value: undefined, error: null })
  useEffect(() => {
    if (!key) return undefined
    return onSnapshot(build(),
      (snap) => setState({ key, value: map(snap), error: null }),
      () => setState({ key, value: null, error: 'Could not load this. Check your connection.' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures what build reads
  }, [key])
  return state.key === key ? state : { value: undefined, error: null }
}

const docs = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }))

export function usePolicies() {
  const { activeId } = useWorkspace()
  const live = useLive(activeId ? `policies|${activeId}` : null,
    () => doc(db, 'businesses', activeId, 'settings', 'policies'), (snap) => snap.data() || {})
  return useMemo(() => {
    if (live.value === undefined) return null
    const p = { ...DEFAULT_POLICIES, ...(live.value || {}) }
    const labels = { ...TIME_OFF_LABELS, ...Object.fromEntries((p.customTimeOffCategories || []).map(c => [c.id, c.label])) }
    return { ...p, categories: (p.timeOffCategories || TIME_OFF_CATEGORIES).map(id => ({ id, label: labels[id] || id })), labels }
  }, [live.value])
}

// One person's availability. Defaults to the signed-in person's own.
export function useAvailability(staffId) {
  const { activeId, member } = useWorkspace()
  const id = staffId || member?.staffId
  const live = useLive(activeId && id ? `availability|${activeId}|${id}` : null,
    () => doc(db, 'businesses', activeId, 'availability', id), (snap) => (snap.exists() ? snap.data() : null))
  return { availability: live.value, loading: live.value === undefined, error: live.error, staffId: id }
}

export function useMyTimeOff() {
  const { activeId } = useWorkspace()
  const { user } = useAuth()
  const live = useLive(activeId && user ? `my-timeoff|${activeId}|${user.uid}` : null,
    () => query(collection(db, 'businesses', activeId, 'timeOff'), where('uid', '==', user.uid)), docs)
  return { items: live.value?.sort((a, b) => b.startDate.localeCompare(a.startDate)) ?? null, error: live.error }
}

// ---- Manager views ----------------------------------------------------------

export function useTeamAvailability() {
  const { activeId, isManager } = useWorkspace()
  const live = useLive(activeId && isManager ? `team-availability|${activeId}` : null,
    () => collection(db, 'businesses', activeId, 'availability'), docs)
  return useMemo(() => live.value ? Object.fromEntries(live.value.map(a => [a.staffId, a])) : live.value, [live.value])
}

// Time off that ends on or after `fromDate`, approved or waiting, for the
// schedule and availability views.
export function useTeamTimeOff(fromDate) {
  const { activeId, isManager } = useWorkspace()
  const live = useLive(activeId && isManager && fromDate ? `team-timeoff|${activeId}|${fromDate}` : null,
    () => query(collection(db, 'businesses', activeId, 'timeOff'), where('endDate', '>=', fromDate)), docs)
  return live.value?.filter(r => ['approved', 'pending'].includes(r.status)) ?? null
}

export function usePendingTimeOff() {
  const { activeId, isManager } = useWorkspace()
  const live = useLive(activeId && isManager ? `pending-timeoff|${activeId}` : null,
    () => query(collection(db, 'businesses', activeId, 'timeOff'), where('status', '==', 'pending')), docs)
  return { items: live.value?.sort((a, b) => a.startDate.localeCompare(b.startDate)) ?? (isManager ? null : []), error: live.error }
}
