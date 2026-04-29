import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from '../AuthContext'

function Footer() {
  const year = new Date().getFullYear()
  const { currentUser } = useAuth()
  const startPath = currentUser ? '/dashboard' : '/signin'

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-main">
          <div className="footer-brand">
            <h3 className="footer-logo">Zaman</h3>
            <p className="footer-tagline">
              Shift scheduling that understands your rules, checks your constraints,
              and tells you when a week cannot work.
            </p>
            <div className="footer-trust">
              <CheckCircle2 size={14} />
              <span>AI rule parsing. Deterministic schedules.</span>
            </div>
          </div>

          <div className="footer-cols">
            <div className="footer-col">
              <h4 className="footer-col-title">Product</h4>
              <ul className="footer-list">
                <li><Link to="/#how-it-works">How it works</Link></li>
                <li><Link to="/pricing">Pricing</Link></li>
                <li><Link to={startPath}>Get started</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-col-title">Company</h4>
              <ul className="footer-list">
                <li><a href="mailto:aliseyfiazadsa6@gmail.com">Contact</a></li>
                <li><Link to="/about">About</Link></li>
                <li><Link to="/security">Security</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-col-title">Legal</h4>
              <ul className="footer-list">
                <li><Link to="/privacy">Privacy</Link></li>
                <li><Link to="/terms">Terms</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p className="footer-copyright">
            © {year} Zaman. All rights reserved.
          </p>
          <p className="footer-made">
            Built for cafes, restaurants, retail teams, and shift managers.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
