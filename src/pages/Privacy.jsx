import { Shield, Database, User } from 'lucide-react'
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

      <Section title={t('privacyRightsTitle')} icon={User} delay={0.2}>
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
