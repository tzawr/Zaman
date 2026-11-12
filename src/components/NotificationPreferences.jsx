import { useEffect, useId, useRef, useState } from 'react'
import { BellRing } from 'lucide-react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'
import { useToast } from './Toast'
import Section from './Section'
import { CATEGORIES, normalizePrefs } from '../../shared/notify/prefs.js'

// Which switches each kind of account sees. Employees do not manage a team or
// a plan, so those rows would only confuse.
const ROWS = {
  manager: ['schedule', 'requests', 'team', 'billing', 'reminders', 'product'],
  employee: ['schedule', 'reminders', 'requests', 'product'],
}

/** Profile → Notifications: email and in-app switches per kind of message. */
function NotificationPreferences() {
  const { currentUser, userData } = useAuth()
  const { t, language } = useI18n()
  const toast = useToast()
  const id = useId()
  const [prefs, setPrefs] = useState(null)
  // The latest choice, so quick successive toggles build on each other
  // instead of on a stale render.
  const latest = useRef(null)

  useEffect(() => {
    if (!currentUser) return undefined
    return onSnapshot(doc(db, 'users', currentUser.uid), s => {
      // Ignore our own pending writes: the local choice is already shown.
      if (s.metadata.hasPendingWrites && latest.current) return
      const next = normalizePrefs(s.data()?.notificationPrefs)
      latest.current = next
      setPrefs(next)
    }, () => { latest.current = normalizePrefs(null); setPrefs(latest.current) })
  }, [currentUser])

  useEffect(() => {
    // Arriving from an email or the bell: bring this section into view.
    if (prefs && window.location.hash === '#notifications') document.getElementById('notifications')?.scrollIntoView({ block: 'start' })
  }, [prefs])

  if (!currentUser || !prefs) return null
  const rows = ROWS[userData?.accountType === 'employee' ? 'employee' : 'manager'].filter(c => CATEGORIES.includes(c))

  async function save(change) {
    const next = change(latest.current)
    latest.current = next
    setPrefs(next)
    try {
      await setDoc(doc(db, 'users', currentUser.uid), { notificationPrefs: next }, { merge: true })
    } catch {
      toast.error(t('notificationPrefsSaveFailed'))
    }
  }
  const toggle = (channel, category) => save(p => ({ ...p, [channel]: { ...p[channel], [category]: !p[channel][category] } }))

  return (
    <div id="notifications" className="notif-prefs-anchor">
      <Section title={t('notificationPrefsTitle')} subtitle={t('notificationPrefsSubtitle')} icon={BellRing}>
        <table className="notif-prefs" aria-describedby={`${id}-essential`}>
          <thead>
            <tr>
              <th scope="col">{t('notificationPrefsKind')}</th>
              <th scope="col">{t('notificationPrefsEmail')}</th>
              <th scope="col">{t('notificationPrefsInApp')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c}>
                <th scope="row">
                  <span className="notif-prefs-name">{t(`notifCat_${c}`)}</span>
                  <span className="notif-prefs-desc">{t(`notifCatDesc_${c}`)}</span>
                </th>
                {['email', 'inApp'].map(channel => (
                  <td key={channel}>
                    <label className="notif-switch">
                      <input type="checkbox" role="switch" checked={prefs[channel][c]}
                        onChange={() => toggle(channel, c)}
                        aria-label={`${t(`notifCat_${c}`)}: ${t(channel === 'email' ? 'notificationPrefsEmail' : 'notificationPrefsInApp')}`} />
                      <span className="notif-switch-track" aria-hidden />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="notif-prefs-lang">
          <label htmlFor={`${id}-lang`}>{t('notificationPrefsLanguage')}</label>
          <select id={`${id}-lang`} className="input" value={prefs.language || language}
            onChange={e => { const language = e.target.value; save(p => ({ ...p, language })) }}>
            <option value="en">English</option>
            <option value="fa">فارسی</option>
          </select>
        </div>
        <p id={`${id}-essential`} className="notif-prefs-note">{t('notificationPrefsEssential')}</p>
      </Section>
    </div>
  )
}

export default NotificationPreferences
