import { Link } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'
import PageHero from '../components/PageHero'
import { useI18n } from '../i18n'

function NotFound() {
  const { t } = useI18n()

  return (
    <main className="app-page app-page-narrow not-found-page">
      <PageHero
        eyebrow="404"
        title={t('notFoundTitle')}
        subtitle={t('notFoundSubtitle')}
      />
      <div className="not-found-actions">
        <Link to="/" className="landing-cta-primary">
          <Home size={16} />
          <span>{t('notFoundHome')}</span>
        </Link>
        <Link to="/pricing" className="landing-cta-ghost">
          <Compass size={16} />
          <span>{t('navPricing')}</span>
        </Link>
      </div>
      <nav className="not-found-links" aria-label={t('notFoundLinksLabel')}>
        <Link to="/about">{t('navAbout')}</Link>
        <Link to="/security">{t('navSecurity')}</Link>
        <Link to="/signin">{t('signIn')}</Link>
        <Link to="/privacy">{t('privacy')}</Link>
        <Link to="/terms">{t('terms')}</Link>
      </nav>
    </main>
  )
}

export default NotFound
