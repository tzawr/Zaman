import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { Loader2, Palmtree } from 'lucide-react'
import { db } from '../../firebase'
import { useI18n } from '../../i18n'
import { describeTimeOff, TIME_OFF_LABELS } from '../../../shared/teams/availability.js'
import { callTeams } from '../../utils/teamsApi'

// Dashboard: time off people asked for in Hengam Teams, decided here. Shown
// only when something is waiting.
export default function TeamsTimeOffPanel({ teamsBizId }) {
  const { t, tf } = useI18n()
  const [requests, setRequests] = useState({ key: null, items: [] })
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!teamsBizId) return undefined
    return onSnapshot(
      query(collection(db, 'businesses', teamsBizId, 'timeOff'), where('status', '==', 'pending')),
      (snap) => setRequests({ key: teamsBizId, items: snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.startDate.localeCompare(b.startDate)) }),
      () => setRequests({ key: teamsBizId, items: [] }),
    )
  }, [teamsBizId])

  async function decide(r, approve) {
    setBusy(`${r.id}:${approve}`)
    setNotice(null)
    try {
      const res = await callTeams('decideTimeOff', { bizId: teamsBizId, timeOffId: r.id, approve })
      setNotice(approve
        ? (res.clashingShifts?.length ? tf('teamsTimeOffClash', { name: r.staffName, count: res.clashingShifts.length }) : t('teamsTimeOffApproved'))
        : t('teamsTimeOffDeclined'))
    } catch (err) {
      setNotice(err.message || t('teamsError'))
    } finally {
      setBusy(null)
    }
  }

  const items = requests.key === teamsBizId ? requests.items : []
  if (!teamsBizId || (!items.length && !notice)) return null
  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header">
        <h2 className="dashboard-section-title">{t('teamsTimeOffTitle')}</h2>
      </div>
      <p className="rule-description" style={{ marginBottom: 12 }}>{t('teamsTimeOffSubtitle')}</p>
      {notice && <div className="rule-description" role="status" style={{ marginBottom: 12 }}>{notice}</div>}
      <div className="dashboard-schedules">
        {items.map(r => (
          <div key={r.id} className="dashboard-schedule-item" style={{ cursor: 'default' }}>
            <div className="dashboard-schedule-icon"><Palmtree size={18} /></div>
            <div className="dashboard-schedule-info">
              <div className="dashboard-schedule-week">{r.staffName} · {TIME_OFF_LABELS[r.category] || r.category}</div>
              <div className="dashboard-schedule-meta">{describeTimeOff(r)}{r.reason ? ` · “${r.reason}”` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="settings-button" disabled={Boolean(busy)} onClick={() => decide(r, true)}>
                {busy === `${r.id}:true` ? <Loader2 size={14} className="spin" /> : null}{t('teamsApprove')}
              </button>
              <button type="button" className="settings-button" disabled={Boolean(busy)} onClick={() => decide(r, false)}>
                {busy === `${r.id}:false` ? <Loader2 size={14} className="spin" /> : null}{t('teamsDecline')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
