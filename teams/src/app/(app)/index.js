import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import ShiftCard from '../../components/ShiftCard'
import VerifyEmailBanner from '../../components/VerifyEmailBanner'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { useAuth } from '../../state/auth'
import { thisWeek, useMyShifts, useNow, useToday, useWorkplaceColors, useWeekSchedule } from '../../state/shifts'
import { useWorkspace } from '../../state/workspace'
import { addDays, formatDuration } from '../../../../shared/teams/time'
import {
  Badge, Banner, Button, Card, EmptyState, Screen, SectionTitle, Skeleton, SkeletonCard, Text,
} from '../../ui/components'

function firstName(user) {
  return String(user?.displayName || '').split(' ')[0]
}

const UPCOMING_DAYS = 14

export default function Home() {
  const router = useRouter()
  const { user } = useAuth()
  const { workplaces, loading, error, isManager } = useWorkspace()
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
        <MyWeek multiple={workplaces.length > 1} />
        {isManager ? <ManagerSummary /> : null}
      </Screen>
    </View>
  )
}

function MyWeek({ multiple }) {
  const today = useToday()
  const colors = useWorkplaceColors()
  const week = thisWeek(today)
  const horizon = addDays(today, UPCOMING_DAYS)
  const { shifts, loading, error } = useMyShifts(week.start < today ? week.start : today, horizon > week.end ? horizon : week.end)
  const now = useNow()

  const { next, upcoming, weekMinutes, weekCount } = useMemo(() => {
    const ahead = shifts.filter(s => s.endAt > now)
    const inWeek = shifts.filter(s => s.date >= week.start && s.date <= week.end)
    return {
      next: ahead[0] || null,
      upcoming: ahead.slice(1, 8),
      weekMinutes: inWeek.reduce((sum, s) => sum + (s.minutes || 0), 0),
      weekCount: inWeek.length,
    }
  }, [shifts, now, week.start, week.end])

  if (loading) {
    return (
      <>
        <Card accessibilityLabel="Loading your next shift">
          <Skeleton width="30%" /><Skeleton width="70%" height={28} /><Skeleton width="45%" />
        </Card>
        <SkeletonCard lines={1} />
      </>
    )
  }

  const inProgress = next && next.startAt <= now
  return (
    <>
      <Banner message={error} />
      <SectionTitle>{inProgress ? 'Working now' : 'Your next shift'}</SectionTitle>
      {next ? (
        <ShiftCard shift={next} color={colors[next.bizId]} today={today} showWorkplace={multiple} prominent />
      ) : (
        <Card>
          <EmptyState icon="calendar" title="No upcoming shifts"
            message="When your workplace publishes a schedule with you on it, your shifts show up here." />
        </Card>
      )}

      <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        accessibilityLabel={`This week: ${formatDuration(weekMinutes)} across ${weekCount} shifts`}>
        <View style={{ gap: 2 }}>
          <Text variant="label" tone="muted">This week</Text>
          <Text variant="title">{weekMinutes ? formatDuration(weekMinutes) : '0h'}</Text>
        </View>
        <Badge label={`${weekCount} ${weekCount === 1 ? 'shift' : 'shifts'}`} tone={weekCount ? 'accent' : 'neutral'} />
      </Card>

      {upcoming.length ? (
        <>
          <SectionTitle>Coming up</SectionTitle>
          <View style={{ gap: 10 }}>
            {upcoming.map(s => <ShiftCard key={`${s.bizId}/${s.id}`} shift={s} color={colors[s.bizId]} today={today} showWorkplace={multiple} />)}
          </View>
        </>
      ) : null}
    </>
  )
}

function ManagerSummary() {
  const router = useRouter()
  const today = useToday()
  const { start } = thisWeek(today)
  const { schedule, shifts, loading } = useWeekSchedule(start)
  if (loading) return <SkeletonCard />
  const published = schedule?.status === 'published'
  const count = shifts?.length || 0
  return (
    <>
      <SectionTitle>Managing</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="heading">This week’s schedule</Text>
          <Badge label={!schedule ? 'Not started' : published ? 'Published' : 'Draft'} tone={published ? 'success' : schedule ? 'warning' : 'neutral'} />
        </View>
        <Text tone="muted">
          {count ? `${count} ${count === 1 ? 'shift' : 'shifts'} scheduled.` : 'Nothing scheduled yet.'}
          {schedule && !published ? ' Your team cannot see it until you publish.' : ''}
        </Text>
        <Button title="Open schedule" variant="secondary" icon="calendar" onPress={() => router.push('/schedule')} />
      </Card>
    </>
  )
}
