import { useState } from 'react'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import DateField from '../components/DateField'
import { ApiError, callTeams } from '../lib/api'
import { pickScheduleFile } from '../lib/pickFile'
import { useToday } from '../state/shifts'
import { useWorkspace } from '../state/workspace'
import { addDays, formatWeekRange, weekStartOf } from '../../../shared/teams/time'
import { Banner, Button, Card, Screen, Text } from '../ui/components'

// Step one of an import: which week, and which file. Reading can take a
// little while for a photo or PDF; the review comes next, and nothing is
// added to the schedule until it is done.
export default function ImportNew() {
  const router = useRouter()
  const today = useToday()
  const { activeId } = useWorkspace()
  const [weekStart, setWeekStart] = useState(() => addDays(weekStartOf(today), 7))
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  async function choose() {
    setError(null)
    let file
    try {
      file = await pickScheduleFile()
    } catch (err) {
      setError({ message: err.message })
      return
    }
    if (!file) return
    const slow = /pdf|image/.test(file.mimeType) || /\.(pdf|jpe?g|png|webp|gif)$/i.test(file.name)
    setBusy(slow ? `Reading ${file.name}. Photos and PDFs take up to a minute.` : `Reading ${file.name}…`)
    try {
      const r = await callTeams('importSchedule', { bizId: activeId, weekStart, fileName: file.name, mimeType: file.mimeType, data: file.data })
      router.replace(`/import/${r.importId}`)
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message } : { message: 'Could not read that file.' })
      setBusy(null)
    }
  }

  return (
    <Screen>
      <Text tone="muted">Bring in a schedule you already have. You’ll check every shift before anything is added, and they arrive as a draft you publish when ready.</Text>
      <Card>
        <Text variant="label">What works</Text>
        <Text tone="muted">• CSV or Excel (.xlsx): a row per shift (Name, Date, Start, End) or a person per row with days across.</Text>
        <Text tone="muted">• PDF or a photo of a printed or handwritten schedule, read by Claude. Anything unclear is marked for you to check.</Text>
      </Card>
      <View style={{ gap: 6 }}>
        <DateField label="Week the schedule is for" value={weekStart} step={7}
          onChange={(d) => setWeekStart(weekStartOf(d))} />
        <Text variant="caption" tone="faint">{formatWeekRange(weekStart)}. Used for files that show weekdays without dates.</Text>
      </View>
      <Banner message={error?.message} />
      {busy ? <Banner tone="info" message={busy} /> : null}
      <Button title="Choose a file" icon="upload" loading={Boolean(busy)} onPress={choose} />
    </Screen>
  )
}
