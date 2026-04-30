import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { SlidersHorizontal, LogOut, Calendar, Clock, LayoutDashboard, Users, BookOpen, Link2, UserCircle } from 'lucide-react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function NavItem({ icon: Icon, label, onClick }) {
  return (
    <button className="dropdown-item" onClick={onClick}>
      <span className="dropdown-icon"><Icon size={16} /></span>
      <span>{label}</span>
    </button>
  )
}

function ProfileMenu({ darkMode, setDarkMode }) {
  const { currentUser, logOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [userData, setUserData] = useState(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!currentUser) { setUserData(null); return }
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), snap => {
      setUserData(snap.exists() ? snap.data() : null)
    })
    return () => unsub()
  }, [currentUser])

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
    try { await logOut(); setOpen(false); navigate('/') } catch {}
  }

  if (!currentUser) {
    return (
      <div className="navbar-right">
        <button className="signin-nav-button" onClick={() => navigate('/signin')}>
          Sign In
        </button>
      </div>
    )
  }

  const displayName = userData?.displayName || currentUser.displayName || 'Manager'
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
              <NavItem icon={Calendar}        label="My Schedule"         onClick={() => go('/my-schedule')} />
              <NavItem icon={Clock}           label="My availability"     onClick={() => go('/my-availability')} />
              <NavItem icon={LayoutDashboard} label="Manager Dashboard"   onClick={() => go('/dashboard', { managerMode: true })} />
            </>
          ) : (
            <>
              <NavItem icon={LayoutDashboard} label="Dashboard"           onClick={() => go('/dashboard')} />
              <NavItem icon={Users}           label="Your team"           onClick={() => go('/employees')} />
              <NavItem icon={BookOpen}        label="Schedule history"    onClick={() => go('/schedules')} />
              <NavItem icon={Link2}           label="Invite team"         onClick={() => go('/invite')} />
            </>
          )}

          <div className="dropdown-divider" />

          <NavItem icon={UserCircle} label="Profile" onClick={() => go('/profile')} />
          {!isEmployee && (
            <NavItem icon={SlidersHorizontal} label="Workspace" onClick={() => go('/settings')} />
          )}

          <div className="dropdown-divider" />

          <button className="dropdown-item dropdown-logout" onClick={handleLogOut}>
            <span className="dropdown-icon"><LogOut size={16} /></span>
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ProfileMenu
