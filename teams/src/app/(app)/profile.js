import { useState } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { ApiError, callTeams } from '../../lib/api'
import { needsVerification, useAuth } from '../../state/auth'
import { useWorkspace } from '../../state/workspace'
import {
  Avatar, Banner, Button, Card, Divider, ListRow, Screen, Segmented, SectionTitle, Text,
} from '../../ui/components'
import { useTheme } from '../../ui/theme'

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }

export default function Profile() {
  const router = useRouter()
  const t = useTheme()
  const { user, signOut } = useAuth()
  const { workplaces, activeId, setActive } = useWorkspace()
  const [confirmLeave, setConfirmLeave] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  async function leave(workplace) {
    setBusy(true)
    setNotice(null)
    try {
      await callTeams('leaveBusiness', { bizId: workplace.id })
      setNotice({ tone: 'success', message: `You left ${workplace.name}.` })
      setConfirmLeave(null)
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not leave this workplace.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Profile" />
      <Screen>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={user?.displayName || user?.email} size={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" numberOfLines={1}>{user?.displayName || 'No name set'}</Text>
              <Text tone="muted" numberOfLines={1}>{user?.email}</Text>
            </View>
          </View>
          {needsVerification(user) ? (
            <Button title="Verify your email" variant="secondary" icon="mail" onPress={() => router.push('/verify-email')} />
          ) : null}
        </Card>

        <Banner tone={notice?.tone} message={notice?.message} />

        {activeId ? (
          <>
            <SectionTitle>At {workplaces?.find(w => w.id === activeId)?.name}</SectionTitle>
            <Card style={{ paddingVertical: 6 }}>
              <ListRow icon="clock" title="My availability" subtitle="When you can work, and temporary changes" onPress={() => router.push('/availability')} />
              <Divider />
              <ListRow icon="sun" title="Request time off" onPress={() => router.push('/timeoff-new')} />
            </Card>
          </>
        ) : null}

        <SectionTitle>Workplaces</SectionTitle>
        <Card style={{ paddingVertical: 6 }}>
          {(workplaces || []).map((w, i) => (
            <View key={w.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                icon="briefcase"
                title={w.name}
                subtitle={`${ROLE_LABEL[w.role] || ''}${w.id === activeId ? ' · Showing now' : ''}`}
                onPress={w.id === activeId ? undefined : () => setActive(w.id)}
                accessibilityLabel={`Switch to ${w.name}`}
                right={confirmLeave === w.id ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button title="Leave" variant="danger" style={{ minHeight: 38, paddingHorizontal: 12 }}
                      loading={busy} onPress={() => leave(w)} accessibilityHint={`Leaves ${w.name}`} />
                    <Button title="Keep" variant="secondary" style={{ minHeight: 38, paddingHorizontal: 12 }}
                      onPress={() => setConfirmLeave(null)} />
                  </View>
                ) : (
                  <Button title="Leave" variant="ghost" style={{ minHeight: 38, paddingHorizontal: 8 }}
                    onPress={() => setConfirmLeave(w.id)} accessibilityHint={`Asks to confirm leaving ${w.name}`} />
                )}
              />
            </View>
          ))}
          {workplaces?.length ? <Divider /> : null}
          <ListRow icon="key" title="Join a workplace" onPress={() => router.push('/join-code')} />
          <Divider />
          <ListRow icon="plus" title="Create a workspace" onPress={() => router.push('/create-workspace')} />
        </Card>

        <SectionTitle>Appearance</SectionTitle>
        <Segmented
          accessibilityLabel="Appearance"
          value={t.preference}
          onChange={t.setPreference}
          options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />

        <View style={{ marginTop: 12 }}>
          <Button title="Sign out" variant="secondary" icon="log-out" onPress={signOut} />
        </View>
        <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>
          To delete your account, use Settings in Hengam. It removes you from every workplace.
        </Text>
      </Screen>
    </View>
  )
}
