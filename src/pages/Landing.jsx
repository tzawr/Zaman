import { useNavigate } from 'react-router-dom'

function Landing() {
  const navigate = useNavigate()

  return (
    <main className="hero">
      <h2 className="hero-title">
        Schedule your team in <span className="accent">minutes</span>, not hours.
      </h2>
      <p className="hero-subtitle">
        AI-powered scheduling for shift managers. Stop forgetting availability.
        Stop wasting your weekends on spreadsheets.
      </p>
      <button className="cta-button" onClick={() => navigate('/employees')}>
        Get Started
      </button>
    </main>
  )
}

export default Landing