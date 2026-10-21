import { Link, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import SocialButtons from '../../components/SocialButtons'
import { safeNext } from '../../lib/next'
import { Button, Screen, Text } from '../../ui/components'
import { useTheme } from '../../ui/theme'

export default function Welcome() {
  const t = useTheme()
  const next = safeNext(useLocalSearchParams().next)
  const query = next ? { next } : {}
  return (
    <Screen contentStyle={{ paddingTop: 72, gap: 28 }}>
      <View style={{ gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: t.color.accentBg,
          alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="clock" size={28} color={t.color.accent} />
        </View>
        <Text variant="title" accessibilityRole="header">Hengam Teams</Text>
        <Text tone="muted" style={{ fontSize: 17, lineHeight: 24 }}>
          Your shifts, every workplace, in one place. Swap and pick up shifts with your team, and ask for time off without the group chat.
        </Text>
      </View>
      <View style={{ gap: 10 }}>
        <Link href={{ pathname: '/sign-up', params: query }} asChild>
          <Button title="Create an account" />
        </Link>
        <Link href={{ pathname: '/sign-in', params: query }} asChild>
          <Button title="Sign in" variant="secondary" />
        </Link>
      </View>
      <SocialButtons />
      <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>
        Already use Hengam? Sign in with the same account.
      </Text>
    </Screen>
  )
}
