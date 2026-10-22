import { useState } from 'react'
import { useRouter } from 'expo-router'
import RangeCalendar from '../components/RangeCalendar'
import { ApiError, callTeams } from '../lib/api'
import { pickScheduleFile } from '../lib/pickFile'
import { useToday } from '../state/shifts'
import { useWorkspace } from '../state/workspace'
import { addDays, formatDateShort, weekStartOf } from '../../../shared/teams/time'
import { Banner, Button, Card, Screen, Text } from '../ui/components'

// Step one of an import: which days it covers, chosen on a calendar, and
// which file. The file's shifts are placed in those days whatever dates it
// carries. Reading can take a little while for a photo or PDF; the review
// comes next, and nothing is added to the schedule until it is done.
export default function ImportNew() {
  const router = useRouter()
  const today = useToday()
  const { activeId } = useWorkspace()
  // Two weeks from this Monday: how schedules are most often sent.
  const [range, setRange] = useState(() => ({ from: weekStartOf(today), to: addDays(weekStartOf(today), 13) }))
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
      const r = await callTeams('importSchedule', { bizId: activeId, from: range.from, to: range.to, fileName: file.name, mimeType: file.mimeType, data: file.data })
      router.replace(`/import/${r.importId}`)
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message } : { message: 'Could not read that file.' })
      setBusy(null)
    }
  }

  return (
    <Screen>
      <Text tone="muted">Add the schedule you already have, in the file you got it in. You’ll see it all before anything is added.</Text>
      <Card style={{ gap: 12 }}>
        <Text variant="label">1. Which days does it cover?</Text>
        <RangeCalendar value={range} onChange={setRange} />
      </Card>
      <Card style={{ gap: 6 }}>
        <Text variant="label">2. Choose the file</Text>
        <Text tone="muted">A Word or Excel file like the one your manager emails, a CSV, a PDF, or a photo or screenshot. Its shifts go in {formatDateShort(range.from)} – {formatDateShort(range.to)}.</Text>
      </Card>
      <Banner message={error?.message} />
      {busy ? <Banner tone="info" message={busy} /> : null}
      <Button title="Choose a file" icon="upload" loading={Boolean(busy)} onPress={choose} />
    </Screen>
  )
}
