import { Tabs } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { useRequestCount } from '../../state/requests'
import { useWorkspace } from '../../state/workspace'
import { useTheme } from '../../ui/theme'

export default function AppTabs() {
  const t = useTheme()
  const { isManager, loading, roleKnown } = useWorkspace()
  const badge = useRequestCount()
  // Which tabs exist depends on the role, so the navigator waits for it.
  // Rendering first and hiding a tab later would bounce a deep link to that
  // tab back to Home.
  if (loading || !roleKnown) {
    return (
      <View style={{ flex: 1, backgroundColor: t.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.color.accent} accessibilityLabel="Loading" />
      </View>
    )
  }
  const icon = (name) => function TabIcon({ color, size }) {
    return <Feather name={name} color={color} size={size - 2} />
  }
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: t.color.accent,
      tabBarInactiveTintColor: t.color.textFaint,
      tabBarStyle: { backgroundColor: t.color.surface, borderTopColor: t.color.border },
      sceneStyle: { backgroundColor: t.color.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="marketplace" options={{ title: 'Marketplace', tabBarIcon: icon('repeat') }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests', tabBarIcon: icon('inbox'), tabBarBadge: badge || undefined }} />
      {/* Five tabs at most. Managers get Manage in place of Profile, which
          they reach from the avatar in the header like everyone else. Its
          button is hidden rather than its href, since href: null also makes
          the route unreachable. */}
      <Tabs.Screen name="manage" options={{ title: 'Manage', tabBarIcon: icon('grid'), href: isManager ? undefined : null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('user'),
        tabBarItemStyle: isManager ? { display: 'none' } : undefined }} />
    </Tabs>
  )
}
