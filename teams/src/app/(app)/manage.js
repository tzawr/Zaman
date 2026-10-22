import { useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import AvailabilityOverview from '../../components/AvailabilityOverview'
import PoliciesEditor from '../../components/PoliciesEditor'
import ScheduleManager from '../../components/ScheduleManager'
import TeamManager from '../../components/TeamManager'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { Screen, Segmented } from '../../ui/components'

// The manager's side of the workplace: the week's schedule, everyone's
// availability, the team, and the business's rules.
export default function Manage() {
  const [section, setSection] = useState('schedule')
  // Arriving from an import: its week, on the schedule. The tab stays
  // mounted, so a new link is noticed here rather than at first render.
  const { week, imported, weeks } = useLocalSearchParams()
  const [seenWeek, setSeenWeek] = useState(week)
  if (week !== seenWeek) {
    setSeenWeek(week)
    if (week) setSection('schedule')
  }
  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Manage" />
      <Screen>
        <Segmented accessibilityLabel="Manage" value={section} onChange={setSection}
          options={[
            { value: 'schedule', label: 'Schedule' }, { value: 'availability', label: 'Availability' },
            { value: 'team', label: 'Team' }, { value: 'settings', label: 'Settings' },
          ]} />
        {section === 'schedule' ? <ScheduleManager key={typeof week === 'string' ? week : 'this-week'}
          week={typeof week === 'string' ? week : undefined} imported={imported} weeks={weeks} />
          : section === 'availability' ? <AvailabilityOverview />
            : section === 'team' ? <TeamManager /> : <PoliciesEditor />}
      </Screen>
    </View>
  )
}
