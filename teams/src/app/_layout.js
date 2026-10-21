import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from '../state/auth'
import { WorkspaceProvider } from '../state/workspace'
import { ThemeProvider, useTheme } from '../ui/theme'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <Navigator />
          </WorkspaceProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

function Navigator() {
  const t = useTheme()
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.color.accent} accessibilityLabel="Loading" />
      </View>
    )
  }

  const signedIn = Boolean(user)
  const modal = { presentation: 'modal', headerShown: true }
  return (
    <>
      <StatusBar style={t.color.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.color.bg },
        headerStyle: { backgroundColor: t.color.surface },
        headerTintColor: t.color.text,
        headerShadowVisible: false,
        animation: 'fade_from_bottom',
      }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" options={{ title: 'Welcome' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" options={{ title: 'Home' }} />
          <Stack.Screen name="create-workspace" options={{ ...modal, title: 'New workspace' }} />
          <Stack.Screen name="join-code" options={{ ...modal, title: 'Join a workplace' }} />
          <Stack.Screen name="workplaces" options={{ ...modal, title: 'Workplaces' }} />
          <Stack.Screen name="invite-new" options={{ ...modal, title: 'Invite someone' }} />
          <Stack.Screen name="member/[uid]" options={{ ...modal, title: 'Team member' }} />
          <Stack.Screen name="shift-edit" options={{ ...modal, title: 'Shift' }} />
          <Stack.Screen name="shift/[bizId]/[shiftId]" options={{ ...modal, title: 'Shift' }} />
          <Stack.Screen name="verify-email" options={{ ...modal, title: 'Verify your email' }} />
        </Stack.Protected>
        {/* Reachable signed in or out: an invite link opened before signing in. */}
        <Stack.Screen name="join/[code]" options={{ headerShown: true, title: 'Invitation' }} />
      </Stack>
    </>
  )
}
