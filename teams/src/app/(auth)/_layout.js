import { Stack } from 'expo-router'
import { useTheme } from '../../ui/theme'

export const unstable_settings = { anchor: 'index' }

export default function AuthLayout() {
  const t = useTheme()
  return (
    <Stack screenOptions={{
      headerShown: true,
      headerTitle: '',
      headerTransparent: false,
      headerStyle: { backgroundColor: t.color.bg },
      headerTintColor: t.color.text,
      headerShadowVisible: false,
      contentStyle: { backgroundColor: t.color.bg },
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  )
}
