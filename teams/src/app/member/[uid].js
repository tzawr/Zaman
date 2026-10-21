import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { ApiError, callTeams } from '../../lib/api'
import { db } from '../../lib/firebase'
import { useWorkspace } from '../../state/workspace'
import { canChangeRole, canRemove } from '../../../../shared/teams/workspace'
import { Avatar, Banner, Button, Card, Screen, SkeletonCard, Text } from '../../ui/components'

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }

export default function Member() {
  const router = useRouter()
  const { uid } = useLocalSearchParams()
  const memberUid = Array.isArray(uid) ? uid[0] : uid
  const { activeId, member: me } = useWorkspace()
  const [target, setTarget] = useState(undefined)
  const [owners, setOwners] = useState(1)
  const [busy, setBusy] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeId || !memberUid) return undefined
    const unsubMember = onSnapshot(doc(db, 'businesses', activeId, 'members', memberUid),
      (snap) => setTarget(snap.exists() ? snap.data() : null), () => setTarget(null))
    const unsubOwners = onSnapshot(query(collection(db, 'businesses', activeId, 'members'),
      where('status', '==', 'active'), where('role', '==', 'owner')),
    (snap) => setOwners(snap.size), () => {})
    return () => { unsubMember(); unsubOwners() }
  }, [activeId, memberUid])

  async function run(action, body, label) {
    setBusy(label)
    setError('')
    try {
      await callTeams(action, { bizId: activeId, memberUid, ...body })
      if (action === 'removeMember') router.back()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (target === undefined) return <Screen><SkeletonCard lines={2} /></Screen>
  if (!target || target.status !== 'active') {
    return <Screen><Banner tone="info" message="This person is no longer in the workspace." /></Screen>
  }

  const roleChoices = ['employee', 'manager', 'owner'].filter(r => canChangeRole(me, target, r, owners))
  const removable = canRemove(me, target, owners)

  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={target.displayName} size={52} />
          <View style={{ gap: 2 }}>
            <Text variant="heading">{target.displayName}</Text>
            <Text tone="muted">{ROLE_LABEL[target.role]}</Text>
          </View>
        </View>
      </Card>
      <Banner message={error} />
      {roleChoices.map(r => (
        <Button key={r} title={`Make ${ROLE_LABEL[r].toLowerCase()}`} variant="secondary"
          loading={busy === r} disabled={Boolean(busy)} onPress={() => run('updateMemberRole', { role: r }, r)} />
      ))}
      {removable && !confirmRemove ? (
        <Button title="Remove from workspace" variant="danger" onPress={() => setConfirmRemove(true)} />
      ) : null}
      {confirmRemove ? (
        <Card>
          <Text>Remove {target.displayName}? They lose access right away. Their past shifts keep their name.</Text>
          <Button title="Remove" variant="danger" loading={busy === 'remove'} onPress={() => run('removeMember', {}, 'remove')} />
          <Button title="Keep them" variant="ghost" onPress={() => setConfirmRemove(false)} />
        </Card>
      ) : null}
      {!roleChoices.length && !removable ? (
        <Text tone="muted">Only an owner can change this person’s role or remove them.</Text>
      ) : null}
    </Screen>
  )
}
