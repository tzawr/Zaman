import { useRouter } from 'expo-router'
import { View } from 'react-native'
import VerifyEmailBanner from '../../components/VerifyEmailBanner'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { useAuth } from '../../state/auth'
import { useWorkspace } from '../../state/workspace'
import { Banner, Button, Card, EmptyState, Screen, SkeletonCard, Text } from '../../ui/components'

function firstName(user) {
  return String(user?.displayName || '').split(' ')[0]
}

export default function Home() {
  const router = useRouter()
  const { user } = useAuth()
  const { workplaces, loading, error, active, isManager } = useWorkspace()
  const name = firstName(user)

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <WorkplaceHeader title="Home" />
        <Screen><SkeletonCard lines={3} /><SkeletonCard /></Screen>
      </View>
    )
  }

  // Not in any workplace yet: the two ways in.
  if (!workplaces?.length) {
    return (
      <View style={{ flex: 1 }}>
        <WorkplaceHeader title={name ? `Hi, ${name}` : 'Welcome'} />
        <Screen>
          <Banner message={error} />
          <VerifyEmailBanner />
          <EmptyState
            icon="briefcase"
            title="Join your workplace"
            message="If your manager sent you an invite, open the link or enter the code. Running a team? Create a workspace and invite them."
          />
          <Button title="Enter an invite code" icon="key" onPress={() => router.push('/join-code')} />
          <Button title="Create a workspace" icon="plus" variant="secondary" onPress={() => router.push('/create-workspace')} />
        </Screen>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title={name ? `Hi, ${name}` : 'Home'} />
      <Screen>
        <Banner message={error} />
        <Card>
          <Text variant="label" tone="muted">Your next shift</Text>
          <EmptyState
            icon="calendar"
            title="No shifts scheduled"
            message={`When ${active?.name || 'your workplace'} publishes a schedule, your shifts show up here.`}
          />
        </Card>
        {isManager ? (
          <Card>
            <Text variant="heading">Bring your team in</Text>
            <Text tone="muted">Each person gets their own invite code. They see only their own shifts unless you choose otherwise.</Text>
            <Button title="Invite someone" icon="user-plus" onPress={() => router.push('/invite-new')} />
          </Card>
        ) : null}
      </Screen>
    </View>
  )
}
