import { createElement, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { SlidersHorizontal, LogOut, Calendar, Clock, LayoutDashboard, Users, BookOpen, Link2, UserCircle } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'

function NavItem({ icon: Icon, label, onClick }) {
  return (
    <button className="dropdown-item" onClick={onClick}>
      <span className="dropdown-icon">{createElement(Icon, { size: 16 })}</span>
      <span>{label}</span>
    </button>
  )
}

function ProfileMenu() {
  const { currentUser, userData, logOut } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function go(path, state) {
    setOpen(false)
    navigate(path, state ? { state } : undefined)
  }

  async function handleLogOut() {
    try {
      await logOut()
      setOpen(false)
      navigate('/')
    } catch {
      setOpen(false)
    }
  }

  if (!currentUser) {
    return (
      <div className="navbar-right">
        <button className="signin-nav-button" onClick={() => navigate('/signin')}>
          {t('signIn')}
        </button>
      </div>
    )
  }

  const displayName = userData?.displayName || currentUser.displayName || t('manager')
  const userRole = userData?.userRole || ''
  const isEmployee = userData?.accountType === 'employee'
  const initial = displayName[0]?.toUpperCase() || '?'

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        className="profile-avatar"
        onClick={() => setOpen(!open)}
        aria-label="Open profile menu"
      >
        {initial}
      </button>

      {open && (
        <div className="profile-dropdown">
          {/* Header */}
          <div className="dropdown-header">
            <div className="dropdown-avatar">{initial}</div>
            <div className="dropdown-user-info">
              <p className="dropdown-name">{displayName}</p>
              {userRole && <p className="dropdown-role">{userRole}</p>}
              <p className="dropdown-email">{currentUser.email}</p>
            </div>
          </div>

          <div className="dropdown-divider" />

          {/* Navigation links */}
          {isEmployee ? (
            <>
              <NavItem icon={Calendar}        label={t('mySchedule')}         onClick={() => go('/my-schedule')} />
              <NavItem icon={Clock}           label={t('myAvailability')}     onClick={() => go('/my-availability')} />
              <NavItem icon={LayoutDashboard} label={t('managerDashboard')}   onClick={() => go('/dashboard', { managerMode: true })} />
            </>
          ) : (
            <>
              <NavItem icon={LayoutDashboard} label={t('dashboard')}           onClick={() => go('/dashboard')} />
              <NavItem icon={Users}           label={t('yourTeam')}           onClick={() => go('/employees')} />
              <NavItem icon={BookOpen}        label={t('scheduleHistory')}    onClick={() => go('/schedules')} />
              <NavItem icon={Link2}           label={t('inviteTeam')}         onClick={() => go('/invite')} />
            </>
          )}

          <div className="dropdown-divider" />

          <NavItem icon={UserCircle} label={t('profile')} onClick={() => go('/profile')} />
          {!isEmployee && (
            <NavItem icon={SlidersHorizontal} label={t('workspace')} onClick={() => go('/settings')} />
          )}

          <div className="dropdown-divider" />

          <button className="dropdown-item dropdown-logout" onClick={handleLogOut}>
            <span className="dropdown-icon"><LogOut size={16} /></span>
            <span>{t('signOut')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ProfileMenu
