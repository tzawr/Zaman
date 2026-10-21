import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from './auth'
import { useNow } from './shifts'
import { useWorkspace } from './workspace'

// Live marketplace and swap data for the current workplace. Each query
// carries the filters the security rules need for this person's role.

function toPlain(d) {
  const data = d.data()
  const conv = (v) => v?.toDate?.() ?? v
  return {
    id: d.id,
    ...data,
    expiresAt: conv(data.expiresAt),
    createdAt: conv(data.createdAt),
    shift: data.shift && { ...data.shift, startAt: conv(data.shift.startAt), endAt: conv(data.shift.endAt) },
    shiftA: data.shiftA && { ...data.shiftA, startAt: conv(data.shiftA.startAt), endAt: conv(data.shiftA.endAt) },
    shiftB: data.shiftB && { ...data.shiftB, startAt: conv(data.shiftB.startAt), endAt: conv(data.shiftB.endAt) },
  }
}

// One live query, keyed so a change of workplace reads as loading rather
// than showing the last workplace's results.
function useLiveQuery(key, build) {
  const [state, setState] = useState({ key: null, items: null, error: null })
  useEffect(() => {
    if (!key) return undefined
    return onSnapshot(build(),
      (snap) => setState({ key, items: snap.docs.map(toPlain), error: null }),
      () => setState({ key, items: [], error: 'Could not load this. Check your connection.' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures everything build depends on
  }, [key])
  return state.key === key ? state : { items: null, error: null }
}

const byStart = (getShift) => (a, b) => getShift(a).startAt - getShift(b).startAt

// Shifts on offer in this workplace that have not passed their cut-off.
export function useOpenOffers() {
  const { activeId } = useWorkspace()
  const now = useNow()
  const live = useLiveQuery(activeId ? `offers|${activeId}` : null,
    () => query(collection(db, 'businesses', activeId, 'offers'), where('status', 'in', ['available', 'pending'])))
  const items = useMemo(() => live.items?.filter(o => o.expiresAt > now).sort(byStart(o => o.shift)) ?? null, [live.items, now])
  return { ...live, items }
}

export function useMySwaps() {
  const { activeId } = useWorkspace()
  const { user } = useAuth()
  const uid = user?.uid
  const asked = useLiveQuery(activeId && uid ? `swaps-out|${activeId}|${uid}` : null,
    () => query(collection(db, 'businesses', activeId, 'swaps'), where('requesterUid', '==', uid)))
  const received = useLiveQuery(activeId && uid ? `swaps-in|${activeId}|${uid}` : null,
    () => query(collection(db, 'businesses', activeId, 'swaps'), where('counterpartyUid', '==', uid)))
  return useMemo(() => {
    if (!asked.items || !received.items) return { loading: true, error: null, incoming: [], outgoing: [], history: [] }
    const all = [...asked.items, ...received.items]
    const open = (s) => ['pending_peer', 'pending_manager'].includes(s.status)
    return {
      loading: false,
      error: asked.error || received.error,
      incoming: received.items.filter(s => s.status === 'pending_peer'),
      outgoing: all.filter(s => open(s) && !(s.counterpartyUid === uid && s.status === 'pending_peer')),
      history: all.filter(s => !open(s)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    }
  }, [asked, received, uid])
}

// What a manager has to decide: offers with someone waiting, and swaps both
// sides have agreed to.
export function useApprovals() {
  const { activeId, isManager } = useWorkspace()
  const on = activeId && isManager
  const offers = useLiveQuery(on ? `approve-offers|${activeId}` : null,
    () => query(collection(db, 'businesses', activeId, 'offers'), where('status', '==', 'pending')))
  const swaps = useLiveQuery(on ? `approve-swaps|${activeId}` : null,
    () => query(collection(db, 'businesses', activeId, 'swaps'), where('status', '==', 'pending_manager')))
  return {
    loading: on && (!offers.items || !swaps.items),
    error: offers.error || swaps.error,
    offers: offers.items || [],
    swaps: swaps.items || [],
    count: on ? (offers.items || []).reduce((n, o) => n + (o.claimantUids?.length || 0), 0) + (swaps.items || []).length : 0,
  }
}

// The pending claims on one offer, for the manager deciding between them.
export function usePendingClaims(offerId) {
  const { activeId } = useWorkspace()
  return useLiveQuery(activeId && offerId ? `claims|${activeId}|${offerId}` : null,
    () => query(collection(db, 'businesses', activeId, 'offers', offerId, 'claims'), where('status', '==', 'pending')))
}
