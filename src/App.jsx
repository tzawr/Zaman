import { useEffect, useState } from 'react'
import { Crown, Mail, Moon, ShieldCheck, Sun } from 'lucide-react'
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import Landing from './pages/Landing'
import Employees from './pages/Employees'
import SignUp from './pages/SignUp'
import SignIn from './pages/SignIn'
import Onboarding from './pages/Onboarding'
import Availability from './pages/Availability'
import Settings from './pages/Settings'
import Schedule from './pages/Schedule'
import ProfileMenu from './components/ProfileMenu'
import Logo from './components/Logo'
import Schedules from './pages/Schedules'
import Footer from './components/Footer'
import Dashboard from './pages/Dashboard'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Security from './pages/Security'
import About from './pages/About'
import PricingPage from './pages/Pricing'
import InviteAccept from './pages/InviteAccept'
import MySchedule from './pages/MySchedule'
import Invite from './pages/Invite'
import VerifyEmail from './pages/VerifyEmail'
import VerifyEmailToken from './pages/VerifyEmailToken'
import ForgotPassword from './pages/ForgotPassword'
import Profile from './pages/Profile'
import AdminUsers from './pages/AdminUsers'
import { I18nProvider, useI18n } from './i18n'
import { isAdminUid } from './utils/admin'
import { getUserTier } from './utils/tier'
import './App.css'

function ProtectedRoute({ children }) {
  const { currentUser, userData } = useAuth()
  if (!currentUser) return <Navigate to="/signin" replace />
  if (userData === undefined) return null
  if (!currentUser.emailVerified) return <Navigate to="/verify-email" replace />
  return children
}

function App() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )
}

function AppShell() {
  const { language, isRtl, t, toggleLanguage } = useI18n()
  const { currentUser, userData } = useAuth()
  const [resolvedTier, setResolvedTier] = useState('free')
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('hengam-theme')
    if (saved === 'light') return false
    return true
  })

  useEffect(() => {
    let active = true
    if (!currentUser) {
      return () => {
        active = false
      }
    }
    getUserTier(currentUser.uid)
      .then((tier) => {
        if (active) setResolvedTier(tier === 'pro' ? 'pro' : 'free')
      })
      .catch(() => {
        if (active) setResolvedTier(userData?.tier === 'pro' ? 'pro' : 'free')
      })
    return () => {
      active = false
    }
  }, [currentUser, userData?.tier])

  const displayTier = currentUser ? resolvedTier : 'free'
  const isPro = currentUser && displayTier === 'pro'
  const isAdmin = isAdminUid(currentUser?.uid)

  return (
    <BrowserRouter>
      <div className={`${darkMode ? 'app dark' : 'app light'} ${isRtl ? 'rtl' : 'ltr'}`} dir="ltr">
        <nav className={`navbar ${isPro ? 'navbar-pro' : ''}`}>
          <Link to="/" className="logo-link" aria-label="Hengam home">
            <Logo size={36} />
          </Link>
          <div className="navbar-center" aria-label="Main navigation">
            <Link to="/about">{t('navAbout')}</Link>
            <Link to="/pricing">{t('navPricing')}</Link>
            <Link to="/security">{t('navSecurity')}</Link>
          </div>
          <div className="navbar-right-group">
            <div className="navbar-actions">
              {currentUser && (
                <Link
                  to="/pricing"
                  className={`navbar-tier-badge ${isPro ? 'pro' : 'free'}`}
                  aria-label={`Current plan: ${isPro ? 'Pro' : 'Free'}`}
                >
                  <Crown size={14} />
                  <span>{isPro ? 'Pro' : 'Free'}</span>
                </Link>
              )}
              {isAdmin && (
                <Link to="/admin/users" className="navbar-admin-link" aria-label="Open admin users panel">
                  <ShieldCheck size={16} />
                </Link>
              )}
              <button
                type="button"
                className="navbar-icon-button"
                aria-label={t('toggleTheme')}
                onClick={() => {
                  const next = !darkMode
                  setDarkMode(next)
                  localStorage.setItem('hengam-theme', next ? 'dark' : 'light')
                }}
              >
                {darkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                type="button"
                className="navbar-language-button"
                aria-label={t('toggleLanguage')}
                onClick={toggleLanguage}
              >
                {language === 'fa' ? 'EN' : 'فا'}
              </button>
              <a className="navbar-icon-button" href="mailto:hello@hengam.app" aria-label="Email Hengam">
                <Mail size={18} />
              </a>
              <a className="navbar-icon-button" href="https://x.com/hengamapp" aria-label="Hengam on X">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a className="navbar-icon-button" href="https://linkedin.com/company/hengamapp" aria-label="Hengam on LinkedIn">
                <svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
              <a className="navbar-icon-button" href="https://github.com/hengamapp" aria-label="Hengam on GitHub">
                <svg viewBox="0 0 24 24" fill="currentColor" width="19" height="19" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
            </div>
            <ProfileMenu />
          </div>
        </nav>

        <Routes>
  <Route path="/" element={<Landing />} />
  <Route path="/signup" element={<SignUp />} />
  <Route path="/signin" element={<SignIn />} />
  <Route path="/verify-email" element={<VerifyEmail />} />
  <Route path="/verify-email/:token" element={<VerifyEmailToken />} />
  <Route path="/forgot-password" element={<ForgotPassword />} />
  <Route path="/invite/:token" element={<InviteAccept />} />
  <Route path="/privacy" element={<Privacy />} />
  <Route path="/terms" element={<Terms />} />
  <Route path="/security" element={<Security />} />
  <Route path="/about" element={<About />} />
  <Route path="/pricing" element={<PricingPage />} />

  <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
  <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
  <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
  <Route path="/employees/:employeeId/availability" element={<ProtectedRoute><Availability /></ProtectedRoute>} />
  <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
  <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
  <Route path="/schedules" element={<ProtectedRoute><Schedules /></ProtectedRoute>} />
  <Route path="/invite" element={<ProtectedRoute><Invite /></ProtectedRoute>} />
  <Route path="/my-schedule" element={<ProtectedRoute><MySchedule /></ProtectedRoute>} />
  <Route path="/my-availability" element={<ProtectedRoute><Availability /></ProtectedRoute>} />
  <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
  <Route path="/admin/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
</Routes>

<Footer />
      </div>
    </BrowserRouter>
  )
}

export default App
