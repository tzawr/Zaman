import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'

function Footer() {
  const year = new Date().getFullYear()
  const { currentUser } = useAuth()
  const { t } = useI18n()
  const startPath = currentUser ? '/dashboard' : '/signin'

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-main">
          <div className="footer-brand">
            <h3 className="footer-logo">Hengam</h3>
            <p className="footer-tagline">
              {t('footerTagline')}
            </p>
            <div className="footer-trust">
              <CheckCircle2 size={14} />
              <span>{t('footerTrust')}</span>
            </div>
          </div>

          <div className="footer-cols">
            <div className="footer-col">
              <h4 className="footer-col-title">{t('product')}</h4>
              <ul className="footer-list">
                <li><Link to="/#how-it-works">{t('howItWorks')}</Link></li>
                <li><Link to="/pricing">{t('navPricing')}</Link></li>
                <li><Link to={startPath}>{t('getStarted')}</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-col-title">{t('company')}</h4>
              <ul className="footer-list">
                <li><a href="mailto:aliseyfiazadsa6@gmail.com">{t('contact')}</a></li>
                <li><Link to="/about">{t('navAbout')}</Link></li>
                <li><Link to="/security">{t('navSecurity')}</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-col-title">{t('legal')}</h4>
              <ul className="footer-list">
                <li><Link to="/privacy">{t('privacy')}</Link></li>
                <li><Link to="/terms">{t('terms')}</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p className="footer-copyright">
            © {year} Hengam. {t('footerRights')}
          </p>
          <p className="footer-made">
            {t('footerMade')}
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
