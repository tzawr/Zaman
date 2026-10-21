import { useState } from 'react'
import { ExternalLink, Loader2, Smartphone } from 'lucide-react'
import Section from '../Section'
import { useI18n } from '../../i18n'
import { callTeams, TEAMS_APP_URL } from '../../utils/teamsApi'

function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Settings: connect this workspace to Hengam Teams, or show that it is.
export default function TeamsConnectSection({ teamsBizId }) {
  const { t } = useI18n()
  const [timezone, setTimezone] = useState(deviceTimezone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function connect() {
    setBusy(true)
    setError('')
    try {
      await callTeams('hengamConnect', { timezone: timezone.trim() })
      // The settings page listens to the user document, which now carries
      // teamsBizId, so it re-renders as connected on its own.
    } catch (err) {
      setError(err.message || t('teamsError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t('teamsSectionTitle')} subtitle={t('teamsSectionSubtitle')} icon={Smartphone}>
      {teamsBizId ? (
        <div className="rule-card">
          <div className="rule-info">
            <p className="rule-title">{t('teamsConnected')}</p>
            <p className="rule-description">{t('teamsConnectedDesc')}</p>
          </div>
          <a className="settings-button" href={TEAMS_APP_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            <span>{t('teamsOpen')}</span>
          </a>
        </div>
      ) : (
        <div className="rule-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <p className="rule-description">{t('teamsConnectDesc')}</p>
          <div>
            <label htmlFor="teams-timezone" className="form-label">{t('teamsTimezone')}</label>
            <input id="teams-timezone" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}
              autoComplete="off" spellCheck={false} />
            <p className="rule-description" style={{ marginTop: 6 }}>{t('teamsTimezoneHint')}</p>
          </div>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button type="button" className="landing-cta-primary" onClick={connect} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Smartphone size={16} />}
            <span>{t('teamsConnect')}</span>
          </button>
        </div>
      )}
    </Section>
  )
}
