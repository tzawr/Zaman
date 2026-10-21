import { useLocalSearchParams } from 'expo-router'
import JoinInvite from '../../components/JoinInvite'
import { Screen } from '../../ui/components'

// Opened from an invite link: teams.hengam.app/join/ABCDE-12345.
export default function JoinLink() {
  const { code } = useLocalSearchParams()
  return <Screen><JoinInvite code={Array.isArray(code) ? code[0] : code} /></Screen>
}
