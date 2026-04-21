import { useState } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Landing from './pages/Landing'
import Employees from './pages/Employees'
import SignUp from './pages/SignUp'
import SignIn from './pages/SignIn'
import Onboarding from './pages/Onboarding'
import Availability from './pages/Availability'
import ProfileMenu from './components/ProfileMenu'
import './App.css'

function App() {
  const [darkMode, setDarkMode] = useState(false)

  return (
    <BrowserRouter>
      <div className={darkMode ? 'app dark' : 'app'}>
        <nav className="navbar">
          <Link to="/" className="logo-link">
            <h1 className="logo">Zaman</h1>
          </Link>
          <ProfileMenu darkMode={darkMode} setDarkMode={setDarkMode} />
        </nav>

        <Routes>
  <Route path="/" element={<Landing />} />
  <Route path="/signup" element={<SignUp />} />
  <Route path="/signin" element={<SignIn />} />
  <Route path="/onboarding" element={<Onboarding />} />
  <Route path="/employees" element={<Employees />} />
  <Route path="/employees/:employeeId/availability" element={<Availability />} />
</Routes>

        <footer className="footer">
          <p>Built with 💙 by جوجو</p>
        </footer>
      </div>
    </BrowserRouter>
  )
}

export default App