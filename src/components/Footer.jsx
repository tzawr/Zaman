import { Link } from 'react-router-dom'

function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-main">
          <div className="footer-brand">
            <h3 className="footer-logo">Zaman</h3>
            <p className="footer-tagline">
              AI scheduling for teams that have better things to do.
            </p>
          </div>

          <div className="footer-cols">
            <div className="footer-col">
              <h4 className="footer-col-title">Product</h4>
              <ul className="footer-list">
                <li><Link to="/">Features</Link></li>
                <li><Link to="/">Pricing</Link></li>
                <li><Link to="/signup">Get started</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-col-title">Company</h4>
              <ul className="footer-list">
                <li><a href="mailto:aliseyfiazadsa6@gmail.com">Contact</a></li>
                <li><a href="#" onClick={(e) => e.preventDefault()}>About</a></li>
                <li><a href="#" onClick={(e) => e.preventDefault()}>Blog</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-col-title">Legal</h4>
              <ul className="footer-list">
                <li><a href="#" onClick={(e) => e.preventDefault()}>Privacy</a></li>
                <li><a href="#" onClick={(e) => e.preventDefault()}>Terms</a></li>
                <li><a href="#" onClick={(e) => e.preventDefault()}>Security</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p className="footer-copyright">
            © {year} Zaman. All rights reserved.
          </p>
          <p className="footer-made">
            Made with intent in Irvine, CA.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer