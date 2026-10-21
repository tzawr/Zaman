import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { collection, doc, onSnapshot } from 'firebase/firestore'
import { isManagerRole } from '../../../shared/teams/workspace'
import { db } from '../lib/firebase'
import { useAuth } from './auth'

// Which workplaces the signed-in person belongs to, which one they are looking
// at, and their membership there. The list comes from users/{uid}/workplaces,
// a mirror the server keeps; the role shown is read from the membership itself.

const WorkspaceContext = createContext(null)
const activeKey = (uid) => `hengam-teams-active-workplace:${uid}`

export function WorkspaceProvider({ children }) {
  const { user } = useAuth()
  const uid = user?.uid
  // Each piece of state remembers whose (or which workplace's) it is, so a
  // change of account or workplace reads as loading instead of showing the
  // previous one's data for a frame.
  const [list, setList] = useState({ uid: null, items: null, error: null })
  const [chosen, setChosen] = useState({ uid: null, id: null })
  const [membership, setMembership] = useState({ key: null, data: null })

  useEffect(() => {
    if (!uid) return undefined
    AsyncStorage.getItem(activeKey(uid)).then(id => setChosen({ uid, id })).catch(() => {})
    return onSnapshot(collection(db, 'users', uid, 'workplaces'), (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      setList({ uid, items, error: null })
    }, () => setList({ uid, items: [], error: 'Could not load your workplaces.' }))
  }, [uid])

  const workplaces = list.uid === uid ? list.items : null
  const error = list.uid === uid ? list.error : null
  const chosenId = chosen.uid === uid ? chosen.id : null

  // A remembered workplace the person has since left falls back to the first.
  const activeId = workplaces?.some(w => w.id === chosenId) ? chosenId : workplaces?.[0]?.id || null
  const active = workplaces?.find(w => w.id === activeId) || null
  const memberKey = uid && activeId ? `${uid}:${activeId}` : null

  useEffect(() => {
    if (!memberKey) return undefined
    return onSnapshot(doc(db, 'businesses', activeId, 'members', uid),
      (snap) => setMembership({ key: memberKey, data: snap.exists() ? snap.data() : null }),
      () => setMembership({ key: memberKey, data: null }))
  }, [memberKey, activeId, uid])

  const member = membership.key === memberKey ? membership.data : null

  const setActive = useCallback((bizId) => {
    setChosen({ uid, id: bizId })
    if (uid) AsyncStorage.setItem(activeKey(uid), bizId).catch(() => {})
  }, [uid])

  const value = useMemo(() => ({
    workplaces,
    loading: Boolean(uid) && workplaces === null,
    error,
    active,
    activeId,
    setActive,
    member,
    // False until the membership for the current workplace has loaded, so
    // anything that depends on the role can wait instead of guessing.
    roleKnown: !activeId || membership.key === memberKey,
    role: member?.status === 'active' ? member.role : null,
    isManager: member?.status === 'active' && isManagerRole(member.role),
  }), [workplaces, uid, error, active, activeId, setActive, member, membership.key, memberKey])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}
