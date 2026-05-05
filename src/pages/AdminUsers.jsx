import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield, Ticket, Trash2, UserCheck } from 'lucide-react'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { ADMIN_UIDS, isAdminUid } from '../utils/admin'
import { isOverrideActive } from '../utils/tier'

function AdminUsers() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [promoDuration, setPromoDuration] = useState('30')
  const [promoMaxUses, setPromoMaxUses] = useState('')
  const [promoExpiresAt, setPromoExpiresAt] = useState('')

  const adminFetch = useCallback(async (options = {}) => {
    const token = await currentUser.getIdToken()
    const response = await fetch('/api/admin-users', {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = body.detail ? ` (${body.detail})` : ''
      throw new Error(`${body.message || body.error || 'Admin request failed'}${detail}`)
    }
    return body
  }, [currentUser])

  const loadUsers = useCallback(async () => {
    try {
      setError('')
      const data = await adminFetch()
      setUsers(data.users || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [adminFetch])

  useEffect(() => {
    if (!currentUser || !isAdminUid(currentUser.uid)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this syncs the admin page with server-side admin data after auth is ready.
    loadUsers()
  }, [currentUser, loadUsers])

  if (!currentUser) return <Navigate to="/signin" replace />
  if (!isAdminUid(currentUser.uid)) {
    return (
      <main className="app-page">
        <div className="empty-state">
          <p>Add your UID to ADMIN_UIDS to show this admin page link.</p>
          <p style={{ marginTop: 8, opacity: 0.7 }}>Current UID: {currentUser.uid}</p>
          <p style={{ marginTop: 8, opacity: 0.7 }}>Server-side admin access is also enforced by ADMIN_UIDS on Vercel.</p>
        </div>
      </main>
    )
  }

  async function grantPro(uid) {
    const duration = window.prompt('Duration: 30, 90, 365, or forever', '30')
    if (!duration) return
    const reason = window.prompt('Reason', 'admin grant')
    if (!reason) return
    await adminFetch({
      method: 'POST',
      body: JSON.stringify({ action: 'grantPro', uid, duration, reason }),
    })
    await loadUsers()
  }

  async function revokeOverride(uid) {
    await adminFetch({
      method: 'POST',
      body: JSON.stringify({ action: 'revokeOverride', uid }),
    })
    await loadUsers()
  }

  async function createPromoCode(e) {
    e.preventDefault()
    const code = promoCode.trim().toUpperCase()
    if (!code) return
    await adminFetch({
      method: 'POST',
      body: JSON.stringify({
        action: 'createPromo',
        code,
        durationDays: promoDuration,
        maxUses: promoMaxUses,
        expiresAt: promoExpiresAt,
      }),
    })
    setPromoCode('')
    setPromoMaxUses('')
    setPromoExpiresAt('')
  }

  return (
    <main className="app-page">
      <button className="app-back-link" onClick={() => navigate('/dashboard')}>
        <ArrowLeft size={14} />
        <span>Back to dashboard</span>
      </button>

      <PageHero eyebrow="Admin" title="Users and Pro access" subtitle={`${ADMIN_UIDS.length} frontend admin UID configured`} />

      {error && <div className="empty-state"><p>{error}</p></div>}

      <Section title="Create promo code" subtitle="Codes are created by the server admin API." icon={Ticket}>
        <form className="employee-form" onSubmit={createPromoCode}>
          <div className="employee-form-row">
            <input className="input" placeholder="FOUNDER50" value={promoCode} onChange={e => setPromoCode(e.target.value)} />
            <select className="input" value={promoDuration} onChange={e => setPromoDuration(e.target.value)}>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="forever">Forever</option>
            </select>
            <input className="input" placeholder="Max uses blank = unlimited" value={promoMaxUses} onChange={e => setPromoMaxUses(e.target.value)} />
            <input className="input" type="date" value={promoExpiresAt} onChange={e => setPromoExpiresAt(e.target.value)} />
          </div>
          <button className="add-button" type="submit">Create code</button>
        </form>
      </Section>

      <Section title="Users" subtitle={loading ? 'Loading users...' : `${users.length} users`} icon={Shield}>
        <div className="roles-list">
          {users.map(user => {
            const override = user.override
            return (
              <div key={user.id} className="role-item">
                <div>
                  <div className="role-name">{user.email || user.displayName || user.id}</div>
                  <div className="team-card-meta">
                    Tier: {user.tier} · Override: {override ? `${override.tier}${isOverrideActive(override) ? '' : ' expired'}` : 'none'}
                  </div>
                </div>
                <div className="role-actions">
                  <button className="role-save-btn" onClick={() => grantPro(user.id)} title="Grant Pro">
                    <UserCheck size={15} />
                  </button>
                  {override && (
                    <button className="role-delete-btn" onClick={() => revokeOverride(user.id)} title="Revoke override">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </main>
  )
}

export default AdminUsers
