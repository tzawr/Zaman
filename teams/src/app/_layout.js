import { useEffect } from 'react'
import { Stack, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, Pressable, Text, View, useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { installGlobalErrorHandlers, reportError, setErrorRoute } from '../lib/monitoring'
import { retryForgottenDevices, usePushNavigation } from '../lib/push'
import { AuthProvider, useAuth } from '../state/auth'
import { WorkspaceProvider } from '../state/workspace'
import { ThemeProvider, useTheme } from '../ui/theme'

installGlobalErrorHandlers()

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
  usePushNavigation()
  // A sign-out that happened offline finishes removing its push entry: at
  // launch, and whenever someone signs in or out here.
  const uid = user?.uid
  useEffect(() => { retryForgottenDevices().catch(() => {}) }, [uid])
  // The route pattern, not the path, so one bug on every shift is one group.
  const segments = useSegments()
  useEffect(() => { setErrorRoute(segments.join('/')) }, [segments])

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
          <Stack.Screen name="offer/[offerId]" options={{ ...modal, title: 'Shift on offer' }} />
          <Stack.Screen name="swap-new" options={{ ...modal, title: 'Swap a shift' }} />
          <Stack.Screen name="availability" options={{ ...modal, title: 'Availability' }} />
          <Stack.Screen name="timeoff-new" options={{ ...modal, title: 'Time off' }} />
          <Stack.Screen name="notifications" options={{ ...modal, title: 'Notifications' }} />
          <Stack.Screen name="calendar-sync" options={{ ...modal, title: 'Calendar sync' }} />
          <Stack.Screen name="import-new" options={{ ...modal, title: 'Import a schedule' }} />
          <Stack.Screen name="import/[importId]" options={{ ...modal, title: 'Review import' }} />
          <Stack.Screen name="imports" options={{ ...modal, title: 'Your imports' }} />
          <Stack.Screen name="verify-email" options={{ ...modal, title: 'Verify your email' }} />
          <Stack.Screen name="delete-account" options={{ ...modal, title: 'Delete account' }} />
        </Stack.Protected>
        {/* Reachable signed in or out: an invite link opened before signing in. */}
        <Stack.Screen name="join/[code]" options={{ headerShown: true, title: 'Invitation' }} />
      </Stack>
    </>
  )
}

// Shown when a screen crashes. It replaces the whole app, outside the theme
// and auth providers, so it uses nothing that could have been what failed.
export function ErrorBoundary({ error, retry }) {
  const dark = useColorScheme() !== 'light'
  useEffect(() => { reportError(error) }, [error])
  const fg = dark ? '#EAF2FF' : '#06101F'
  return (
    <View role="main" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12,
      backgroundColor: dark ? '#030816' : '#F7FAFF' }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: fg, textAlign: 'center' }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 16, color: dark ? '#AAB6CB' : '#42516A', textAlign: 'center', maxWidth: 340 }}>
        Hengam Teams hit a problem on this screen. We have been told about it. Your schedule and requests are safe.
      </Text>
      <Pressable onPress={retry} accessibilityRole="button"
        style={{ marginTop: 8, minHeight: 50, paddingHorizontal: 24, borderRadius: 12, justifyContent: 'center',
          backgroundColor: dark ? '#60A5FA' : '#1D4ED8' }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: dark ? '#030816' : '#FFFFFF' }}>Try again</Text>
      </Pressable>
    </View>
  )
}
