import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { ApiError, callTeams } from '../../lib/api'
import { db } from '../../lib/firebase'
import { copyInvite, shareInvite } from '../../lib/inviteLink'
import { useAuth } from '../../state/auth'
import { useWorkspace } from '../../state/workspace'
import { canInvite, formatInviteCode } from '../../../../shared/teams/workspace'
import {
  Avatar, Badge, Banner, Button, Card, Divider, EmptyState, ListRow, Screen, SectionTitle, SkeletonCard, Text,
} from '../../ui/components'

const ROLE_ORDER = { owner: 0, manager: 1, employee: 2 }
const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }

function useCollection(path, constraints, enabled) {
  const key = enabled ? `${path}|${JSON.stringify(constraints)}` : null
  const [state, setState] = useState({ key: null, items: null, error: null })
  useEffect(() => {
    if (!key) return undefined
    const ref = constraints.length ? query(collection(db, path), ...constraints.map(c => where(...c))) : collection(db, path)
    return onSnapshot(ref,
      (snap) => setState({ key, items: snap.docs.map(d => ({ id: d.id, ...d.data() })), error: null }),
      () => setState({ key, items: [], error: 'Could not load this list. Check your connection.' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures path and constraints
  }, [key])
  return state.key === key ? state : { items: null, error: null }
}

function expiresIn(invite) {
  const at = invite.expiresAt?.toDate?.()
  if (!at) return ''
  const days = Math.ceil((at - Date.now()) / 86400000)
  return days <= 0 ? 'Expired' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`
}

export default function Team() {
  const router = useRouter()
  const { user } = useAuth()
  const { activeId, active, member, isManager } = useWorkspace()
  const members = useCollection(`businesses/${activeId}/members`, [['status', '==', 'active']], Boolean(activeId && isManager))
  const invites = useCollection(`businesses/${activeId}/invites`, [['status', '==', 'open']], Boolean(activeId && isManager))
  const [notice, setNotice] = useState(null)
  const [busyId, setBusyId] = useState(null)

  if (!isManager) {
    return (
      <View style={{ flex: 1 }}>
        <WorkplaceHeader title="Team" />
        <Screen><EmptyState icon="lock" title="Managers only" message="Your manager runs the team list for this workplace." /></Screen>
      </View>
    )
  }

  const sortedMembers = (members.items || []).slice()
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || String(a.displayName).localeCompare(String(b.displayName)))
  const sortedInvites = (invites.items || []).slice()
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))

  async function share(invite) {
    try {
      const how = await shareInvite({ ...invite, businessName: active?.name })
      if (how === 'copied') setNotice({ tone: 'success', message: `Link for ${invite.staffName} copied.` })
    } catch {
      // Dismissing the share sheet is not an error.
    }
  }

  async function copy(invite) {
    await copyInvite(invite)
    setNotice({ tone: 'success', message: `Link for ${invite.staffName} copied.` })
  }

  async function revoke(invite) {
    setBusyId(invite.id)
    setNotice(null)
    try {
      await callTeams('revokeInvite', { bizId: activeId, inviteId: invite.id })
      setNotice({ tone: 'success', message: `Invite for ${invite.staffName} cancelled.` })
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not cancel the invite.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Team" />
      <Screen>
        <Banner tone={notice?.tone} message={notice?.message} />
        <Button title="Invite someone" icon="user-plus" onPress={() => router.push('/invite-new')} />

        <SectionTitle>Pending invites</SectionTitle>
        {invites.items === null ? <SkeletonCard /> : (
          <Card>
            <Banner message={invites.error} />
            {sortedInvites.length === 0 ? (
              <Text tone="muted">No open invites. Everyone you invited has joined.</Text>
            ) : sortedInvites.map((invite, i) => (
              <View key={invite.id} style={{ gap: 10 }}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={invite.staffName} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={1}>{invite.staffName}</Text>
                    <Text variant="caption" tone="muted">
                      {ROLE_LABEL[invite.role]} · {expiresIn(invite)}
                    </Text>
                  </View>
                  <Text variant="label" tone="accent" selectable accessibilityLabel={`Invite code ${invite.code.split('').join(' ')}`}>
                    {formatInviteCode(invite.code)}
                  </Text>
                </View>
                {canInvite(member, invite.role) ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title="Share" icon="share" variant="secondary" style={{ flex: 1, minHeight: 42 }} onPress={() => share(invite)} />
                    <Button title="Copy" icon="copy" variant="secondary" style={{ flex: 1, minHeight: 42 }} onPress={() => copy(invite)} />
                    <Button title="Cancel" variant="danger" style={{ flex: 1, minHeight: 42 }}
                      loading={busyId === invite.id} onPress={() => revoke(invite)}
                      accessibilityHint={`Cancels the invite for ${invite.staffName}`} />
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        )}

        <SectionTitle>{members.items ? `People · ${sortedMembers.length}` : 'People'}</SectionTitle>
        {members.items === null ? <SkeletonCard lines={3} /> : (
          <Card style={{ paddingVertical: 6 }}>
            <Banner message={members.error} />
            {sortedMembers.map((m, i) => (
              <View key={m.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={m.id === user?.uid ? `${m.displayName} (you)` : m.displayName}
                  right={<Badge label={ROLE_LABEL[m.role]} tone={m.role === 'employee' ? 'neutral' : 'accent'} />}
                  onPress={m.id === user?.uid ? undefined : () => router.push(`/member/${m.id}`)}
                  accessibilityLabel={`${m.displayName}, ${ROLE_LABEL[m.role]}. Open options`}
                />
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </View>
  )
}
