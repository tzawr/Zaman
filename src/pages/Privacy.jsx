import { Shield, Database, User, Cookie, Building2, Scale } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

function Privacy() {
  const { t } = useI18n()

  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow={t('privacyEyebrow')}
        title={t('privacyTitle')}
        subtitle={t('privacySubtitle')}
      />

      <Section title={t('privacyCollectTitle')} icon={Database} delay={0.05}>
        <div className="legal-text">
          <p>{t('privacyCollectIntro')}</p>
          <ul>
            <li><strong>{t('privacyAccountStrong')}</strong> — {t('privacyAccountCopy')}</li>
            <li><strong>{t('privacyWorkspaceStrong')}</strong> — {t('privacyWorkspaceCopy')}</li>
            <li><strong>{t('privacyUsageStrong')}</strong> — {t('privacyUsageCopy')}</li>
          </ul>
          <p>{t('privacyCollectP1')}</p>
        </div>
      </Section>

      <Section title={t('privacyUseTitle')} icon={Shield} delay={0.1}>
        <div className="legal-text">
          <p>{t('privacyUseIntro')}</p>
          <ul>
            <li>{t('privacyUse1')}</li>
            <li>{t('privacyUse2')}</li>
            <li>{t('privacyUse3')}</li>
            <li>{t('privacyUse4')}</li>
          </ul>
          <p>{t('privacyUseP1')}</p>
        </div>
      </Section>

      <Section title={t('privacyStorageTitle')} icon={Database} delay={0.15}>
        <div className="legal-text">
          <p>{t('privacyStorageP1')}</p>
          <p>{t('privacyStorageP2')}</p>
          <p>{t('privacyStorageP3')}</p>
        </div>
      </Section>

      <Section title={t('privacySubprocessorsTitle')} icon={Shield} delay={0.2}>
        <div className="legal-text">
          <p>{t('privacySubprocessorsIntro')}</p>
          <ul>
            <li>{t('privacySubFirebase')}</li>
            <li>{t('privacySubVercel')}</li>
            <li>{t('privacySubAnthropic')}</li>
            <li>{t('privacySubResend')}</li>
          </ul>
          <p>{t('privacySubprocessorsP1')}</p>
        </div>
      </Section>

      <Section title={t('privacyCookiesTitle')} icon={Cookie} delay={0.25}>
        <div className="legal-text">
          <p>{t('privacyCookiesIntro')}</p>
          <ul>
            <li>{t('privacyCookies1')}</li>
            <li>{t('privacyCookies2')}</li>
            <li>{t('privacyCookies3')}</li>
          </ul>
          <p>{t('privacyCookiesP1')}</p>
          <p>{t('privacyCookiesP2')}</p>
        </div>
      </Section>

      <Section title={t('privacyLawsTitle')} icon={Scale} delay={0.3}>
        <div className="legal-text">
          <p>{t('privacyLawsIntro')}</p>
          <ul>
            <li>{t('privacyLaws1')}</li>
            <li>{t('privacyLaws2')}</li>
            <li>{t('privacyLaws3')}</li>
            <li>{t('privacyLaws4')}</li>
            <li>{t('privacyLaws5')}</li>
          </ul>
          <p>{t('privacyLawsP1')}</p>
          <p>{t('privacyLawsP2')}</p>
        </div>
      </Section>

      <Section title={t('privacyBusinessTitle')} icon={Building2} delay={0.35}>
        <div className="legal-text">
          <p>{t('privacyBusinessP1')}</p>
          <p>
            {t('privacyBusinessP2')}{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>.
          </p>
        </div>
      </Section>

      <Section title={t('privacyRightsTitle')} icon={User} delay={0.4}>
        <div className="legal-text">
          <p>
            {t('privacyRightsP1')}{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>.
          </p>
          <p>{t('privacyRightsP2')}</p>
        </div>
      </Section>
    </main>
  )
}

export default Privacy
