import { useState } from 'react'
import { Heart } from 'lucide-react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Landing from './pages/Landing'
import Employees from './pages/Employees'
import SignUp from './pages/SignUp'
import SignIn from './pages/SignIn'
import Onboarding from './pages/Onboarding'
import Availability from './pages/Availability'
import Settings from './pages/Settings'
import Schedule from './pages/Schedule'
import ProfileMenu from './components/ProfileMenu'
import Schedules from './pages/Schedules'
import Footer from './components/Footer'
import Dashboard from './pages/Dashboard'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Security from './pages/Security'
import About from './pages/About'
import InviteAccept from './pages/InviteAccept'
import MySchedule from './pages/MySchedule'
import Invite from './pages/Invite'
import './App.css'

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('zaman-theme')
    if (saved === 'light') return false
    return true
  })

  function toggleTheme() {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('zaman-theme', next ? 'dark' : 'light')
  }

  return (
    <BrowserRouter>
      <div className={darkMode ? 'app dark' : 'app light'}>
        <nav className="navbar">
          <Link to="/" className="logo-link">
            <h1 className="logo">Zaman</h1>
          </Link>
          <ProfileMenu darkMode={darkMode} setDarkMode={(v) => {
  setDarkMode(v)
  localStorage.setItem('zaman-theme', v ? 'dark' : 'light')
}} />
        </nav>

        <Routes>
  <Route path="/" element={<Landing />} />
  <Route path="/signup" element={<SignUp />} />
  <Route path="/signin" element={<SignIn />} />
  <Route path="/onboarding" element={<Onboarding />} />
  <Route path="/employees" element={<Employees />} />
  <Route path="/employees/:employeeId/availability" element={<Availability />} />
  <Route path="/settings" element={<Settings />} />
  <Route path="/schedule" element={<Schedule />} />
  <Route path="/schedules" element={<Schedules />} />
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/privacy" element={<Privacy />} />
  <Route path="/terms" element={<Terms />} />
  <Route path="/security" element={<Security />} />
  <Route path="/about" element={<About />} />
  <Route path="/invite/:token" element={<InviteAccept />} />
  <Route path="/invite" element={<Invite />} />
  <Route path="/my-schedule" element={<MySchedule />} />
</Routes>

<Footer />
      </div>
    </BrowserRouter>
  )
}

export default App