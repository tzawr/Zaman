import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { ArrowLeft, Shield, Ticket, Trash2, UserCheck } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { ADMIN_UIDS, isAdminUid } from '../utils/admin'
import { getUserTier, isOverrideActive, normalizeTier } from '../utils/tier'

function durationToExpiresAt(duration) {
  if (duration === 'forever') return null
  const days = { '30': 30, '90': 90, '365': 365 }[duration] || 30
  return Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
}

function AdminUsers() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [overrides, setOverrides] = useState({})
  const [tiers, setTiers] = useState({})
  const [loading, setLoading] = useState(true)
  const [promoCode, setPromoCode] = useState('')
  const [promoDuration, setPromoDuration] = useState('30')
  const [promoMaxUses, setPromoMaxUses] = useState('')
  const [promoExpiresAt, setPromoExpiresAt] = useState('')

  useEffect(() => {
    if (!currentUser || !isAdminUid(currentUser.uid)) return
    const unsubUsers = onSnapshot(query(collection(db, 'users')), async (snap) => {
      const rows = snap.docs.map(userDoc => ({ id: userDoc.id, ...userDoc.data() }))
      setUsers(rows)
      setLoading(false)
      const tierEntries = await Promise.all(rows.map(async row => [row.id, await getUserTier(row.id)]))
      setTiers(Object.fromEntries(tierEntries))
    })
    const unsubOverrides = onSnapshot(collection(db, 'adminOverrides'), (snap) => {
      setOverrides(Object.fromEntries(snap.docs.map(overrideDoc => [overrideDoc.id, overrideDoc.data()])))
    })
    return () => {
      unsubUsers()
      unsubOverrides()
    }
  }, [currentUser])

  if (!currentUser) return <Navigate to="/signin" replace />
  if (!isAdminUid(currentUser.uid)) {
    return (
      <main className="app-page">
        <div className="empty-state">
          <p>Add your UID to ADMIN_UIDS to use this admin page.</p>
          <p style={{ marginTop: 8, opacity: 0.7 }}>Current UID: {currentUser.uid}</p>
        </div>
      </main>
    )
  }

  async function grantPro(uid) {
    const duration = window.prompt('Duration: 30, 90, 365, or forever', '30')
    if (!duration) return
    const reason = window.prompt('Reason', 'admin grant')
    if (!reason) return
    await setDoc(doc(db, 'adminOverrides', uid), {
      tier: 'pro',
      expiresAt: durationToExpiresAt(duration),
      reason,
      grantedBy: currentUser.uid,
      grantedAt: serverTimestamp(),
    })
    setTiers(prev => ({ ...prev, [uid]: 'pro' }))
  }

  async function revokeOverride(uid) {
    await deleteDoc(doc(db, 'adminOverrides', uid))
    setTiers(prev => ({ ...prev, [uid]: normalizeTier(users.find(user => user.id === uid)?.tier) }))
  }

  async function createPromoCode(e) {
    e.preventDefault()
    const code = promoCode.trim().toUpperCase()
    if (!code) return
    await setDoc(doc(db, 'promoCodes', code), {
      code,
      tier: 'pro',
      durationDays: promoDuration === 'forever' ? null : Number(promoDuration),
      maxUses: promoMaxUses.trim() ? Number(promoMaxUses) : null,
      usedCount: increment(0),
      expiresAt: promoExpiresAt ? Timestamp.fromDate(new Date(`${promoExpiresAt}T23:59:59`)) : null,
      active: true,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
    }, { merge: true })
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

      <PageHero eyebrow="Admin" title="Users and Pro access" subtitle={`${ADMIN_UIDS.length} admin UID configured`} />

      <Section title="Create promo code" subtitle="Codes are stored uppercase in promoCodes." icon={Ticket}>
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
            const override = overrides[user.id]
            return (
              <div key={user.id} className="role-item">
                <div>
                  <div className="role-name">{user.email || user.displayName || user.id}</div>
                  <div className="team-card-meta">
                    Tier: {tiers[user.id] || normalizeTier(user.tier)} · Override: {override ? `${override.tier}${isOverrideActive(override) ? '' : ' expired'}` : 'none'}
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
