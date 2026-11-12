import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, ExternalLink, Settings2 } from 'lucide-react'
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'
import { notificationText } from '../../shared/notify/text.js'
import { callTeams, TEAMS_APP_URL } from '../utils/teamsApi'

const SHOWN = 30

function when(ts, language) {
  const d = ts?.toDate?.()
  if (!d) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  const rtf = new Intl.RelativeTimeFormat(language === 'fa' ? 'fa-IR-u-nu-latn' : 'en', { numeric: 'auto' })
  if (mins < 60) return rtf.format(-Math.max(mins, 0), 'minute')
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour')
  return rtf.format(-Math.round(mins / 1440), 'day')
}

/** The bell in the signed-in header: unread count and the latest notifications. */
function NotificationBell() {
  const { currentUser } = useAuth()
  const { t, tf, language } = useI18n()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!currentUser) return undefined
    const q = query(collection(db, 'users', currentUser.uid, 'notifications'), orderBy('createdAt', 'desc'), limit(SHOWN))
    return onSnapshot(q, snap => { setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setError(false) }, () => setError(true))
  }, [currentUser])

  useEffect(() => {
    function outside(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  const unread = items.filter(n => !n.readAt).length
  const shown = useMemo(() => items.map(n => {
    const text = notificationText(n.type, n.facts || {}, language)
    // Teams messages keep their stored English unless reading in Persian.
    const useStored = language !== 'fa' && n.app !== 'web' && n.title
    return { ...n, title: useStored ? n.title : (text?.title || n.title), body: useStored ? n.body : (text?.body ?? n.body) }
  }), [items, language])

  if (!currentUser) return null

  async function openItem(n) {
    if (!n.readAt) updateDoc(doc(db, 'users', currentUser.uid, 'notifications', n.id), { readAt: serverTimestamp() }).catch(() => {})
    setOpen(false)
    const link = typeof n.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/'
    if (n.app === 'web') navigate(link)
    else window.open(`${TEAMS_APP_URL}${link}`, '_blank', 'noopener')
  }

  async function markAll() {
    await callTeams('markAllNotificationsRead').catch(() => {})
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); triggerRef.current?.focus() }
  }
  function onBlur(e) {
    if (open && wrapRef.current && !wrapRef.current.contains(e.relatedTarget)) setOpen(false)
  }

  const label = unread ? tf('notificationsUnread', { count: unread }) : t('notifications')
  return (
    <div className="notif-bell" ref={wrapRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button ref={triggerRef} type="button" className="navbar-icon-button notif-bell-button"
        aria-label={label} aria-expanded={open} aria-controls="notif-panel" onClick={() => setOpen(o => !o)}>
        <Bell size={18} aria-hidden />
        {unread > 0 && <span className="notif-badge" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" id="notif-panel" role="region" aria-label={t('notifications')} dir={language === 'fa' ? 'rtl' : 'ltr'} lang={language}>
          <div className="notif-head">
            <h2 className="notif-title">{t('notifications')}</h2>
            <button type="button" className="notif-head-btn" onClick={markAll} disabled={!unread}>
              <CheckCheck size={15} aria-hidden /><span>{t('notificationsMarkAll')}</span>
            </button>
          </div>
          {error ? (
            <p className="notif-empty">{t('notificationsLoadError')}</p>
          ) : shown.length === 0 ? (
            <div className="notif-empty"><Bell size={22} aria-hidden /><p>{t('notificationsEmpty')}</p></div>
          ) : (
            <ul className="notif-list">
              {shown.map(n => (
                <li key={n.id}>
                  <button type="button" className={`notif-item ${n.readAt ? '' : 'unread'}`} onClick={() => openItem(n)}>
                    <span className="notif-dot" aria-hidden />
                    <span className="notif-text">
                      <span className="notif-item-title">{n.title}</span>
                      {n.body && <span className="notif-item-body">{n.body}</span>}
                      <span className="notif-item-meta">
                        {when(n.createdAt, language)}
                        {n.app !== 'web' && <><span aria-hidden> · </span><ExternalLink size={11} aria-hidden /> <span>{t('notificationsInTeams')}</span></>}
                        {!n.readAt && <span className="sr-only">, {t('notificationsUnreadOne')}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="notif-foot" onClick={() => { setOpen(false); navigate('/profile#notifications') }}>
            <Settings2 size={14} aria-hidden /><span>{t('notificationSettings')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default NotificationBell
