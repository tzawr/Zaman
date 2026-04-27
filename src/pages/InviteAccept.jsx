import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, UserCheck } from 'lucide-react'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function InviteAccept() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { currentUser, signUp, signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('signup')

  // If already signed in, accept the invite immediately
  useEffect(() => {
    if (!currentUser) return
    setLoading(true)
    acceptInvite(currentUser.uid, currentUser.email).catch(err => {
      setError(err.message || 'Failed to accept invite.')
      setLoading(false)
    })
  }, [currentUser])

  async function acceptInvite(uid, userEmail) {
    const inviteRef = doc(db, 'invites', token)
    const inviteSnap = await getDoc(inviteRef)

    if (!inviteSnap.exists()) {
      throw new Error('This invite link is invalid.')
    }
    const invite = inviteSnap.data()
    if (invite.used) {
      throw new Error('This invite link has already been used.')
    }

    await setDoc(doc(db, 'users', uid), {
      email: userEmail,
      displayName: invite.employeeName,
      accountType: 'employee',
      managerId: invite.managerId,
      linkedEmployeeId: invite.employeeId,
      employeeName: invite.employeeName,
      onboarded: true,
      createdAt: serverTimestamp(),
    }, { merge: true })

    await updateDoc(inviteRef, { used: true })
    navigate('/my-schedule')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    try {
      let cred
      if (mode === 'signup') {
        cred = await signUp(email, password)
      } else {
        cred = await signIn(email, password)
      }
      await acceptInvite(cred.user.uid, cred.user.email)
    } catch (err) {
      setError(prettyError(err.code) || err.message || 'Something went wrong.')
      setLoading(false)
    }
  }

  if (loading && currentUser) {
    return (
      <main className="auth-page">
        <div className="empty-state"><p>Accepting invite...</p></div>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <div className="auth-bg">
        <motion.div
          className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="auth-eyebrow">
          <UserCheck size={14} />
          <span>Team invite</span>
        </div>

        <h1 className="auth-title">
          Join your team on{' '}
          <span className="landing-gradient-text">Zaman</span>
        </h1>
        <p className="auth-subtitle">
          {mode === 'signup'
            ? 'Create a free account to see your shifts.'
            : 'Sign in to your existing account to accept this invite.'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="input"
              placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button
            type="submit"
            className="landing-cta-primary auth-submit"
            disabled={loading}
          >
            <span>
              {loading
                ? 'Joining...'
                : mode === 'signup'
                  ? 'Create account & join'
                  : 'Sign in & join'}
            </span>
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="auth-footer">
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <button className="link-button" onClick={() => setMode('signin')}>
                Sign in instead
              </button>
            </>
          ) : (
            <>
              New to Zaman?{' '}
              <button className="link-button" onClick={() => setMode('signup')}>
                Create account
              </button>
            </>
          )}
        </p>
      </motion.div>
    </main>
  )
}

function prettyError(code) {
  const map = {
    'auth/email-already-in-use': 'That email already has an account. Try signing in instead.',
    'auth/invalid-email': 'That email looks wrong.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email.',
    'auth/invalid-credential': 'Wrong email or password.',
  }
  return map[code]
}

export default InviteAccept
