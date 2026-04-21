import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Employees from './pages/Employees'
import './App.css'

function App() {
  const [darkMode, setDarkMode] = useState(false)

  return (
    <BrowserRouter>
      <div className={darkMode ? 'app dark' : 'app'}>
        <nav className="navbar">
          <h1 className="logo">Zaman</h1>
          <button 
            className="theme-toggle" 
            onClick={() => setDarkMode(!darkMode)}
            aria-label="Toggle theme"
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </nav>

        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/employees" element={<Employees />} />
        </Routes>

        <footer className="footer">
          <p>Built with 💙 by جوجو</p>
        </footer>
      </div>
    </BrowserRouter>
  )
}

export default App