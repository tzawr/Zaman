import { useEffect, useMemo, useState } from 'react'
import { Timestamp, collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { addDays, todayIn, weekStartOf } from '../../../shared/teams/time'
import { db } from '../lib/firebase'
import { useAuth } from './auth'
import { useWorkspace } from './workspace'

// Live shift data for the screens. Employees read their own published shifts
// from every workplace at once; managers read a whole week of their current
// workplace. The queries carry the filters the security rules require.

// Distinct, readable on both themes, and assigned in workplace order so a
// workplace keeps its colour from screen to screen.
const WORKPLACE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#A855F7', '#EF4444', '#14B8A6']

export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// The current time, refreshed each minute, so "next shift" moves on and the
// day rolls over at midnight for an app left open.
export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function useToday() {
  return todayIn(deviceTimezone(), new Date(useNow()))
}

export function useWorkplaceColors() {
  const { workplaces } = useWorkspace()
  return useMemo(() => Object.fromEntries((workplaces || []).map((w, i) => [w.id, WORKPLACE_COLORS[i % WORKPLACE_COLORS.length]])), [workplaces])
}

function toShift(d, workplace) {
  const data = d.data()
  return {
    id: d.id,
    ...data,
    startAt: data.startAt?.toDate?.(),
    endAt: data.endAt?.toDate?.(),
    bizId: workplace.id,
    workplaceName: workplace.name,
  }
}

// The signed-in person's published shifts, across all their workplaces, whose
// business-local date falls between fromDate and toDate inclusive.
export function useMyShifts(fromDate, toDate) {
  const { user } = useAuth()
  const { workplaces } = useWorkspace()
  const uid = user?.uid
  const ids = (workplaces || []).map(w => `${w.id}:${w.name}`).join('|')
  const key = uid && workplaces ? `${uid}|${ids}|${fromDate}|${toDate}` : null
  const [state, setState] = useState({ key: null, byWorkplace: {}, errors: {} })

  useEffect(() => {
    if (!key) return undefined
    // Dates are business-local, so the instant range is padded by a day on
    // each side and trimmed by date afterwards.
    const from = Timestamp.fromDate(new Date(`${addDays(fromDate, -1)}T00:00:00Z`))
    const to = Timestamp.fromDate(new Date(`${addDays(toDate, 2)}T00:00:00Z`))
    const fresh = (s) => (s.key === key ? s : { key, byWorkplace: {}, errors: {} })
    const unsubs = workplaces.map(w => onSnapshot(
      query(collection(db, 'businesses', w.id, 'shifts'),
        where('assigneeUid', '==', uid), where('published', '==', true),
        where('startAt', '>=', from), where('startAt', '<', to), orderBy('startAt')),
      (snap) => setState(prev => {
        const s = fresh(prev)
        return { ...s, byWorkplace: { ...s.byWorkplace, [w.id]: snap.docs.map(d => toShift(d, w)) }, errors: { ...s.errors, [w.id]: null } }
      }),
      () => setState(prev => {
        const s = fresh(prev)
        return { ...s, byWorkplace: { ...s.byWorkplace, [w.id]: [] }, errors: { ...s.errors, [w.id]: w.name } }
      }),
    ))
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures uid, workplaces and the range
  }, [key])

  return useMemo(() => {
    const current = state.key === key ? state : { byWorkplace: {}, errors: {} }
    const loaded = (workplaces || []).every(w => current.byWorkplace[w.id])
    const shifts = Object.values(current.byWorkplace).flat()
      .filter(s => s.status !== 'cancelled' && s.date >= fromDate && s.date <= toDate)
      .sort((a, b) => a.startAt - b.startAt)
    const failed = Object.values(current.errors).filter(Boolean)
    return {
      shifts,
      loading: !key || !loaded,
      error: failed.length ? `Could not load shifts from ${failed.join(', ')}.` : null,
    }
  }, [state, key, workplaces, fromDate, toDate])
}

// A manager's view of one week of the current workplace: the schedule's
// status and every shift in it.
export function useWeekSchedule(weekStart) {
  const { activeId, isManager } = useWorkspace()
  const key = activeId && isManager ? `${activeId}|${weekStart}` : null
  const [state, setState] = useState({ key: null, schedule: undefined, shifts: null, error: null })

  useEffect(() => {
    if (!key) return undefined
    const unsubSchedule = onSnapshot(doc(db, 'businesses', activeId, 'schedules', weekStart),
      (snap) => setState(s => ({ ...(s.key === key ? s : { shifts: null, error: null }), key, schedule: snap.exists() ? snap.data() : null })),
      () => setState(s => ({ ...s, key, schedule: null, error: 'Could not load this week.' })))
    const unsubShifts = onSnapshot(query(collection(db, 'businesses', activeId, 'shifts'), where('scheduleId', '==', weekStart)),
      (snap) => setState(s => ({
        ...(s.key === key ? s : { schedule: undefined, error: null }), key,
        shifts: snap.docs.map(d => toShift(d, { id: activeId, name: '' }))
          .filter(sh => sh.status !== 'cancelled').sort((a, b) => a.startAt - b.startAt),
      })),
      () => setState(s => ({ ...s, key, shifts: [], error: 'Could not load this week.' })))
    return () => { unsubSchedule(); unsubShifts() }
  }, [key, activeId, weekStart])

  const current = state.key === key ? state : { schedule: undefined, shifts: null, error: null }
  return { ...current, loading: current.schedule === undefined || current.shifts === null }
}

// The roster of the current workplace, for choosing who works a shift.
export function useStaff() {
  const { activeId } = useWorkspace()
  const [state, setState] = useState({ key: null, staff: null })
  useEffect(() => {
    if (!activeId) return undefined
    return onSnapshot(collection(db, 'businesses', activeId, 'staff'),
      (snap) => setState({ key: activeId, staff: snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))) }),
      () => setState({ key: activeId, staff: [] }))
  }, [activeId])
  return state.key === activeId ? state.staff : null
}

export function thisWeek(today) {
  const start = weekStartOf(today)
  return { start, end: addDays(start, 6) }
}
