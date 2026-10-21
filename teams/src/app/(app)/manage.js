import { useState } from 'react'
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
  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Manage" />
      <Screen>
        <Segmented accessibilityLabel="Manage" value={section} onChange={setSection}
          options={[
            { value: 'schedule', label: 'Schedule' }, { value: 'availability', label: 'Availability' },
            { value: 'team', label: 'Team' }, { value: 'settings', label: 'Settings' },
          ]} />
        {section === 'schedule' ? <ScheduleManager />
          : section === 'availability' ? <AvailabilityOverview />
            : section === 'team' ? <TeamManager /> : <PoliciesEditor />}
      </Screen>
    </View>
  )
}
