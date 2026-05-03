import { FileText, Users, AlertTriangle, Scale } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

function Terms() {
  const { t } = useI18n()

  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow={t('termsEyebrow')}
        title={t('termsTitle')}
        subtitle={t('termsSubtitle')}
      />

      <Section title={t('termsUsingTitle')} icon={FileText} delay={0.05}>
        <div className="legal-text">
          <p>{t('termsUsingP1')}</p>
          <p>{t('termsUsingP2')}</p>
          <ul>
            <li>{t('termsUsing1')}</li>
            <li>{t('termsUsing2')}</li>
            <li>{t('termsUsing3')}</li>
            <li>{t('termsUsing4')}</li>
          </ul>
        </div>
      </Section>

      <Section title={t('termsAcceptableTitle')} icon={AlertTriangle} delay={0.1}>
        <div className="legal-text">
          <p>{t('termsAcceptableIntro')}</p>
          <ul>
            <li>{t('termsAcceptable1')}</li>
            <li>{t('termsAcceptable2')}</li>
            <li>{t('termsAcceptable3')}</li>
            <li>{t('termsAcceptable4')}</li>
            <li>{t('termsAcceptable5')}</li>
          </ul>
        </div>
      </Section>

      <Section title={t('termsEmployeesTitle')} icon={Users} delay={0.15}>
        <div className="legal-text">
          <p>{t('termsEmployeesP1')}</p>
          <p>{t('termsEmployeesP2')}</p>
        </div>
      </Section>

      <Section title={t('termsLiabilityTitle')} icon={Scale} delay={0.2}>
        <div className="legal-text">
          <p>{t('termsLiabilityP1')}</p>
          <p>{t('termsLiabilityP2')}</p>
          <p>{t('termsLiabilityP3')}</p>
          <p>
            {t('termsLiabilityP4')}{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>.
          </p>
        </div>
      </Section>
    </main>
  )
}

export default Terms
