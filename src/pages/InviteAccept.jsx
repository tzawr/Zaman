import { useCallback, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { ArrowRight, UserCheck } from 'lucide-react'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { sendEmailVerification } from 'firebase/auth'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'

function InviteAccept() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { currentUser, signUp, signIn } = useAuth()
  const { t } = useI18n()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('signup')

  const acceptInvite = useCallback(async (uid, userEmail) => {
    const inviteRef = doc(db, 'invites', token)
    const inviteSnap = await getDoc(inviteRef)

    if (!inviteSnap.exists()) {
      throw new Error(t('invalidInvite'))
    }
    const invite = inviteSnap.data()
    if (invite.used) {
      const existingUserSnap = await getDoc(doc(db, 'users', uid))
      const existingUser = existingUserSnap.exists() ? existingUserSnap.data() : null
      if (invite.usedBy === uid || existingUser?.linkedEmployeeId === invite.employeeId) {
        return
      }
      throw new Error(t('inviteAlreadyUsed'))
    }

    await setDoc(doc(db, 'users', uid), {
      email: userEmail,
      displayName: invite.employeeName,
      accountType: 'employee',
      managerId: invite.managerId,
      linkedEmployeeId: invite.employeeId,
      employeeName: invite.employeeName,
      employeeRole: invite.employeeRole || t('employee'),
      allowEmployeeFullView: invite.allowEmployeeFullView === true,
      allowEmployeeAvailabilityUpdates: invite.allowEmployeeAvailabilityUpdates !== false,
      onboarded: true,
      createdAt: serverTimestamp(),
    }, { merge: true })

    try {
      await updateDoc(doc(db, 'employees', invite.employeeId), {
        accountUserId: uid,
        accountEmail: userEmail,
        portalJoinedAt: serverTimestamp()
      })
    } catch {
      // Manager-owned employee records may reject employee writes in production rules.
      // The employee portal uses linkedEmployeeId from the user doc above, so this
      // stamp is helpful but not required to finish joining.
    }

    try {
      await updateDoc(inviteRef, {
        used: true,
        usedBy: uid,
        usedAt: serverTimestamp()
      })
    } catch {
      // Some rules only let managers update invite docs. Do not leave the employee
      // stuck after their Auth account and user doc were created successfully.
    }
  }, [token, t])

  // If already signed in, accept the invite immediately
  useEffect(() => {
    if (!currentUser) return
    if (loading) return
    let cancelled = false

    async function run() {
      setLoading(true)
      try {
        await acceptInvite(currentUser.uid, currentUser.email)
        if (cancelled) return
        navigate(currentUser.emailVerified ? '/my-schedule' : '/verify-email')
      } catch (err) {
        if (cancelled) return
        setError(err.message || t('failedAcceptInvite'))
        setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [acceptInvite, currentUser, loading, navigate, t])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && password.length < 6) {
      setError(t('authWeakPassword'))
      return
    }
    setLoading(true)
    try {
      let cred
      if (mode === 'signup') {
        cred = await signUp(email, password)
        await sendEmailVerification(cred.user)
        await acceptInvite(cred.user.uid, cred.user.email)
        navigate('/verify-email')
        return
      } else {
        cred = await signIn(email, password)
        await acceptInvite(cred.user.uid, cred.user.email)
        if (!cred.user.emailVerified) {
          navigate('/verify-email')
          return
        }
      }
      navigate('/my-schedule')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setMode('signin')
        setError(t('accountAlreadyCreatedJoin'))
      } else {
        setError(prettyError(err.code, t) || err.message || t('authGeneric'))
      }
      setLoading(false)
    }
  }

  if (loading && currentUser) {
    return (
      <main className="auth-page">
        <div className="empty-state"><p>{t('acceptingInvite')}</p></div>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <div className="auth-bg">
        <Motion.div
          className="auth-blob auth-blob-1"
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Motion.div
          className="auth-blob auth-blob-2"
          animate={{ x: [0, -30, 20, 0], y: [0, 20, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <Motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="auth-eyebrow">
          <UserCheck size={14} />
          <span>{t('teamInvite')}</span>
        </div>

        <h1 className="auth-title">
          {t('joinTeamTitleBefore')}{' '}
          <span className="landing-gradient-text">Hengam</span>
        </h1>
        <p className="auth-subtitle">
          {mode === 'signup'
            ? t('inviteSignupSubtitle')
            : t('inviteSigninSubtitle')}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="form-label">{t('email')}</label>
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
            <label className="form-label">{t('password')}</label>
            <input
              type="password"
              className="input"
              placeholder={mode === 'signup' ? t('passwordPlaceholder') : t('yourPassword')}
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
                ? t('joining')
                : mode === 'signup'
                  ? t('createAccountJoin')
                  : t('signInJoin')}
            </span>
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="auth-footer">
          {mode === 'signup' ? (
            <>
              {t('alreadyHaveAccount')}{' '}
              <button className="link-button" onClick={() => setMode('signin')}>
                {t('signInInstead')}
              </button>
            </>
          ) : (
            <>
              {t('newToHengam')}{' '}
              <button className="link-button" onClick={() => setMode('signup')}>
                {t('createAccount')}
              </button>
            </>
          )}
        </p>
      </Motion.div>
    </main>
  )
}

function prettyError(code, t) {
  const map = {
    'auth/email-already-in-use': t('authEmailInUse'),
    'auth/invalid-email': t('authInvalidEmail'),
    'auth/weak-password': t('authWeakPassword'),
    'auth/too-many-requests': t('authTooMany'),
    'auth/wrong-password': t('wrongEmailPassword'),
    'auth/user-not-found': t('authUserNotFound'),
    'auth/invalid-credential': t('wrongEmailPassword'),
  }
  return map[code]
}

export default InviteAccept
