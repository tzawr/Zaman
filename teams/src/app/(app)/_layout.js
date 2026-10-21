import { Tabs } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useWorkspace } from '../../state/workspace'
import { useTheme } from '../../ui/theme'

// Tabs arrive with the phases that fill them: Calendar, Marketplace and
// Requests join Home and Profile as those features land.
export default function AppTabs() {
  const t = useTheme()
  const { isManager, loading, roleKnown } = useWorkspace()
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
      {/* Only managers run the team; for everyone else the tab is not there. */}
      <Tabs.Screen name="team" options={{ title: 'Team', tabBarIcon: icon('users'), href: isManager ? undefined : null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('user') }} />
    </Tabs>
  )
}
