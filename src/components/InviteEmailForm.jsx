import { useId, useState } from 'react'
import { Mail } from 'lucide-react'
import { useI18n } from '../i18n'
import { callTeams } from '../utils/teamsApi'

export const EMAIL_ENABLED = import.meta.env.VITE_EMAIL_ENABLED === '1'

/** "Email this invite": sends the invite link from HENGAM to the address typed. */
function InviteEmailForm({ link }) {
  const { t, tf, language } = useI18n()
  const id = useId()
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ status: 'idle', message: '' })
  const inviteId = String(link || '').split('/invite/')[1] || ''
  if (!EMAIL_ENABLED || !inviteId) return null

  async function send(e) {
    e.preventDefault()
    setState({ status: 'sending', message: '' })
    try {
      await callTeams('emailInvite', { inviteId, email: email.trim(), language })
      setState({ status: 'sent', message: tf('inviteEmailSent', { email: email.trim() }) })
    } catch (err) {
      setState({ status: 'error', message: err.message || t('inviteEmailFailed') })
    }
  }

  return (
    <form className="invite-email-form" onSubmit={send}>
      <label htmlFor={id} className="invite-email-label">{t('inviteEmailLabel')}</label>
      <div className="invite-email-row">
        <input id={id} type="email" required autoComplete="off" placeholder="name@example.com" value={email}
          onChange={e => { setEmail(e.target.value); if (state.status !== 'sending') setState({ status: 'idle', message: '' }) }} />
        <button type="submit" className="invite-copy-btn" disabled={state.status === 'sending' || !email.trim()}>
          <Mail size={14} aria-hidden />
          <span>{state.status === 'sending' ? t('sending') : t('inviteEmailSend')}</span>
        </button>
      </div>
      {state.message && (
        <p className={`invite-email-status ${state.status}`} role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>
      )}
    </form>
  )
}

export default InviteEmailForm
