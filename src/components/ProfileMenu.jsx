import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Sun, Settings, LogOut } from 'lucide-react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../AuthContext'

function ProfileMenu({ darkMode, setDarkMode }) {
  const { currentUser, logOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [userData, setUserData] = useState(null)
  const menuRef = useRef(null)

  // Load user profile data (name + role) from Firebase
  useEffect(() => {
    if (!currentUser) {
      setUserData(null)
      return
    }
    
    const userDocRef = doc(db, 'users', currentUser.uid)
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserData(snapshot.data())
      } else {
        setUserData(null)
      }
    })
    
    return () => unsubscribe()
  }, [currentUser])

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleLogOut() {
    try {
      await logOut()
      setOpen(false)
      navigate('/')
    } catch (err) {
      console.error('Failed to log out:', err)
    }
  }

  // Not signed in → show Sign In button
  if (!currentUser) {
    return (
      <div className="navbar-right">
        <button 
          className="signin-nav-button"
          onClick={() => navigate('/signin')}
        >
          Sign In
        </button>
      </div>
    )
  }

  // Figure out what to display
  const displayName = userData?.displayName || currentUser.displayName || 'Manager'
  const userRole = userData?.userRole || ''
  const initial = displayName[0].toUpperCase()

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
          <div className="dropdown-header">
            <div className="dropdown-avatar">{initial}</div>
            <div className="dropdown-user-info">
              <p className="dropdown-name">{displayName}</p>
              {userRole && <p className="dropdown-role">{userRole}</p>}
              <p className="dropdown-email">{currentUser.email}</p>
            </div>
          </div>

          <div className="dropdown-divider"></div>

          <button 
            className="dropdown-item"
            onClick={() => {
              setDarkMode(!darkMode)
            }}
          >
            <span className="dropdown-icon">
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </span>
            <span>{darkMode ? 'Light mode' : 'Dark mode'}</span>
          </button>

          <button 
            className="dropdown-item"
            onClick={() => {
              setOpen(false)
              navigate('/settings')
            }}
          >
            <span className="dropdown-icon"><Settings size={16} /></span>
            <span>Settings</span>
          </button>

          <div className="dropdown-divider"></div>

          <button 
            className="dropdown-item dropdown-logout"
            onClick={handleLogOut}
          >
            <span className="dropdown-icon"><LogOut size={16} /></span>
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ProfileMenu