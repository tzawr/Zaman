import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useWorkspace } from '../state/workspace'
import { closeModal } from '../lib/next'
import { Card, Divider, ListRow, Screen } from '../ui/components'
import { useTheme } from '../ui/theme'

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }

export default function Workplaces() {
  const router = useRouter()
  const t = useTheme()
  const { workplaces, activeId, setActive } = useWorkspace()

  return (
    <Screen>
      <Card style={{ paddingVertical: 6 }}>
        {(workplaces || []).map((w, i) => (
          <View key={w.id}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              icon="briefcase"
              title={w.name}
              subtitle={ROLE_LABEL[w.role]}
              accessibilityLabel={`${w.name}${w.id === activeId ? ', selected' : ''}`}
              onPress={() => { setActive(w.id); closeModal(router) }}
              right={w.id === activeId ? <Feather name="check" size={20} color={t.color.accent} /> : <View />}
            />
          </View>
        ))}
      </Card>
      <Card style={{ paddingVertical: 6 }}>
        <ListRow icon="key" title="Join a workplace" onPress={() => router.replace('/join-code')} />
        <Divider />
        <ListRow icon="plus" title="Create a workspace" onPress={() => router.replace('/create-workspace')} />
      </Card>
    </Screen>
  )
}
