import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '../state/auth'
import { useWorkspace } from '../state/workspace'
import { Avatar, Badge, Skeleton, Text } from '../ui/components'
import { useTheme } from '../ui/theme'

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }

// The current workplace at the top of each tab. Tapping it switches.
export default function WorkplaceHeader({ title }) {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { active, role, workplaces, loading } = useWorkspace()
  const { user } = useAuth()

  return (
    <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 4, backgroundColor: t.color.bg }}>
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 6 }}>
        {loading ? <Skeleton width={160} height={20} /> : active ? (
          <Pressable
            onPress={() => router.push('/workplaces')}
            accessibilityRole="button"
            accessibilityLabel={`Current workplace: ${active.name}. ${workplaces?.length > 1 ? 'Switch workplace' : 'Manage workplaces'}`}
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}
          >
            <Text variant="label" tone="accent" numberOfLines={1} style={{ maxWidth: 240 }}>{active.name}</Text>
            <Feather name="chevron-down" size={16} color={t.color.accent} />
            {role ? <Badge label={ROLE_LABEL[role]} tone="neutral" /> : null}
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="title" accessibilityRole="header">{title}</Text>
          <Pressable onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="Profile and settings" hitSlop={8}>
            <Avatar name={user?.displayName || user?.email} size={36} />
          </Pressable>
        </View>
      </View>
    </View>
  )
}
