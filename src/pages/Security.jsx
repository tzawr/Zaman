import { Lock, Server, ShieldCheck } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

function Security() {
  const { t } = useI18n()

  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow={t('securityEyebrow')}
        title={t('securityTitle')}
        subtitle={t('securitySubtitle')}
      />

      <Section title={t('securityAuthTitle')} icon={Lock} delay={0.05}>
        <div className="legal-text">
          <p>{t('securityAuthP1')}</p>
        </div>
      </Section>

      <Section title={t('securityDataTitle')} icon={Server} delay={0.1}>
        <div className="legal-text">
          <ul>
            <li>
              <strong>{t('securityTransitStrong')}</strong> — {t('securityTransitCopy')}
            </li>
            <li>
              <strong>{t('securityRestStrong')}</strong> — {t('securityRestCopy')}
            </li>
            <li>
              <strong>{t('securityRulesStrong')}</strong> — {t('securityRulesCopy')}
            </li>
          </ul>
          <p>{t('securityDataP1')}</p>
        </div>
      </Section>

      <Section title={t('securityDisclosureTitle')} icon={ShieldCheck} delay={0.15}>
        <div className="legal-text">
          <p>
            {t('securityDisclosureP1')}{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>{' '}
            {t('securityDisclosureP1Tail')}
          </p>
          <p>{t('securityDisclosureP2')}</p>
        </div>
      </Section>
    </main>
  )
}

export default Security
