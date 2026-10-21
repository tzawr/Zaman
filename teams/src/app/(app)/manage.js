import { useState } from 'react'
import { View } from 'react-native'
import ScheduleManager from '../../components/ScheduleManager'
import TeamManager from '../../components/TeamManager'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { Screen, Segmented } from '../../ui/components'

// The manager's side of the workplace: the week's schedule, and the team.
export default function Manage() {
  const [section, setSection] = useState('schedule')
  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Manage" />
      <Screen>
        <Segmented accessibilityLabel="Manage" value={section} onChange={setSection}
          options={[{ value: 'schedule', label: 'Schedule' }, { value: 'team', label: 'Team' }]} />
        {section === 'schedule' ? <ScheduleManager /> : <TeamManager />}
      </Screen>
    </View>
  )
}
