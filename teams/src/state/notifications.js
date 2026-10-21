import { useEffect, useState } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from './auth'

// The signed-in person's notifications, newest first. The server writes
// them; the person can only mark them read.

export function useNotifications() {
  const { user } = useAuth()
  const uid = user?.uid
  const [state, setState] = useState({ key: null, items: null, error: null })
  useEffect(() => {
    if (!uid) return undefined
    return onSnapshot(
      query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => setState({ key: uid, items: snap.docs.map(d => ({ id: d.id, ...d.data() })), error: null }),
      () => setState({ key: uid, items: [], error: 'Could not load notifications.' }),
    )
  }, [uid])
  const current = state.key === uid ? state : { items: null, error: null }
  return { ...current, unread: (current.items || []).filter(n => !n.readAt).length }
}

export async function markRead(uid, id) {
  await updateDoc(doc(db, 'users', uid, 'notifications', id), { readAt: serverTimestamp() })
}
