import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { ApiError, callTeams } from '../lib/api'
import { useAuth } from '../state/auth'
import { markRead, useNotifications } from '../state/notifications'
import { Banner, Button, EmptyState, Screen, SkeletonCard, Text } from '../ui/components'
import { useTheme } from '../ui/theme'

const ICONS = {
  schedule_published: 'calendar', schedule_changed: 'edit-3', marketplace_shift: 'repeat',
  pickup_requested: 'user-plus', pickup_decided: 'check-circle', swap_requested: 'shuffle',
  swap_decided: 'check-circle', time_off_requested: 'sun', time_off_decided: 'sun', shift_reminder: 'bell',
}

function ago(ts) {
  const d = ts?.toDate?.()
  if (!d) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Notifications() {
  const router = useRouter()
  const t = useTheme()
  const { user } = useAuth()
  const { items, error, unread } = useNotifications()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  async function open(n) {
    if (!n.readAt) markRead(user.uid, n.id).catch(() => {})
    if (n.link) router.push(n.link)
  }

  async function readAll() {
    setBusy(true)
    try {
      await callTeams('markAllNotificationsRead')
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not mark them read.')
    } finally {
      setBusy(false)
    }
  }

  if (items === null) return <Screen><SkeletonCard /><SkeletonCard /></Screen>
  return (
    <Screen>
      <Banner message={error || notice} />
      {unread ? <Button title="Mark all as read" variant="secondary" loading={busy} onPress={readAll} /> : null}
      {items.length ? items.map(n => (
        <Pressable key={n.id} onPress={() => open(n)} accessibilityRole="button"
          accessibilityLabel={`${n.readAt ? '' : 'Unread. '}${n.title}. ${n.body}. ${ago(n.createdAt)}`}
          style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 14, borderRadius: t.radius.lg, borderWidth: 1,
            borderColor: n.readAt ? t.color.border : t.color.borderStrong,
            backgroundColor: pressed ? t.color.pressed : n.readAt ? t.color.surface : t.color.accentBg })}>
          <Feather name={ICONS[n.type] || 'bell'} size={20} color={n.readAt ? t.color.textMuted : t.color.accent} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label">{n.title}</Text>
            <Text tone="muted">{n.body}</Text>
            <Text variant="caption" tone="faint">{ago(n.createdAt)}</Text>
          </View>
          {!n.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color.accent, marginTop: 6 }} /> : null}
        </Pressable>
      )) : (
        <EmptyState icon="bell" title="Nothing yet" message="Schedules, swaps, pickups and time off decisions show up here." />
      )}
    </Screen>
  )
}
