import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Link2, Copy, Check, X, Users } from 'lucide-react'
import { collection, query, where, onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

function Invite() {
  const navigate = useNavigate()
  const { currentUser, userData } = useAuth()

  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteModal, setInviteModal] = useState(null) // { employeeName, link, copied }

  useEffect(() => {
    if (!currentUser) { navigate('/signin'); return }
    const q = query(collection(db, 'employees'), where('userId', '==', currentUser.uid))
    const unsub = onSnapshot(q, snap => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return () => unsub()
  }, [currentUser, navigate])

  async function generateInvite(emp) {
    const token = crypto.randomUUID()
    await setDoc(doc(db, 'invites', token), {
      managerId: currentUser.uid,
      employeeId: emp.id,
      employeeName: emp.name,
      employeeRole: emp.role,
      allowEmployeeFullView: userData?.allowEmployeeFullView === true,
      allowEmployeeAvailabilityUpdates: userData?.allowEmployeeAvailabilityUpdates !== false,
      createdAt: serverTimestamp(),
      used: false,
    })
    setInviteModal({
      employeeName: emp.name,
      link: `${window.location.origin}/invite/${token}`,
      copied: false,
    })
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteModal.link)
    setInviteModal(m => ({ ...m, copied: true }))
    setTimeout(() => setInviteModal(m => m ? { ...m, copied: false } : m), 2000)
  }

  return (
    <main className="app-page">
      <button className="app-back-link" onClick={() => navigate('/dashboard')}>
        <ArrowLeft size={14} />
        <span>Back to dashboard</span>
      </button>

      <PageHero
        eyebrow="Team"
        title="Invite your team"
        subtitle="Generate a personal invite link for each team member. Each link works once and expires after use."
      />

      <Section
        title={loading ? 'Loading...' : employees.length === 0 ? 'No team members yet' : `${employees.length} ${employees.length === 1 ? 'person' : 'people'} on your team`}
        subtitle={employees.length === 0 ? 'Add team members first on the Employees page.' : 'Click Invite to generate a unique link for each person.'}
        icon={Users}
      >
        {loading ? (
          <div className="empty-state"><p>Loading team...</p></div>
        ) : employees.length === 0 ? (
          <div className="empty-state">
            <Users size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>No team members yet.</p>
            <button className="add-button" style={{ marginTop: 12 }} onClick={() => navigate('/employees')}>
              Add team members
            </button>
          </div>
        ) : (
          <div className="dashboard-invite-grid">
            {employees.map((emp, i) => (
              <motion.div
                key={emp.id}
                className="dashboard-invite-card"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                <div className="employee-avatar">{emp.name[0]?.toUpperCase()}</div>
                <div className="dashboard-invite-info">
                  <div className="dashboard-invite-name">{emp.name}</div>
                  <div className="dashboard-invite-role">{emp.role}</div>
                </div>
                <button
                  className="dashboard-invite-btn"
                  onClick={() => generateInvite(emp)}
                >
                  <Link2 size={13} />
                  <span>Get invite link</span>
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </Section>

      {inviteModal && (
        <div className="modal-backdrop" onClick={() => setInviteModal(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="shift-modal-header">
              <h3 className="modal-title">Invite {inviteModal.employeeName}</h3>
              <button className="modal-close-btn" onClick={() => setInviteModal(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="shift-modal-day">
              Share this link with {inviteModal.employeeName}. They'll create a free account for their shifts, availability, and time off.
            </p>
            <div className="invite-link-box">
              <span className="invite-link-text">{inviteModal.link}</span>
              <button className="invite-copy-btn" onClick={copyInviteLink}>
                {inviteModal.copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{inviteModal.copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            <p className="invite-link-note">This link can only be used once. Generate a new one if needed.</p>
          </div>
        </div>
      )}
    </main>
  )
}

export default Invite
