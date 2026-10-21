import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useToast } from '../Toast'
import { callTeams } from '../../utils/teamsApi'

// Schedule history: send a saved week to Hengam Teams, or update it there.
// Publishing again is safe: an unchanged week is recognised and left alone.
export default function TeamsPublishButton({ schedule }) {
  const { t, tf } = useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const sent = Boolean(schedule.teamsPublishedAt)

  async function publish() {
    setBusy(true)
    try {
      const r = await callTeams('hengamPublish', { scheduleId: schedule.id })
      toast.success(r.unchanged ? t('teamsPublishUnchanged') : tf('teamsPublishResult', r))
    } catch (err) {
      toast.error(err.message || t('teamsError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="settings-button" onClick={publish} disabled={busy}
      title={sent ? `${t('teamsPublishedAt')}: ${schedule.teamsPublishedAt.toDate?.().toLocaleString()}` : undefined}>
      {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
      <span>{sent ? t('teamsRepublish') : t('teamsPublish')}</span>
    </button>
  )
}
