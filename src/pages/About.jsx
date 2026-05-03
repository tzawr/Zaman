import { Zap, Target, Mail } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

function About() {
  const { t } = useI18n()

  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow={t('aboutEyebrow')}
        title={t('aboutTitle')}
        subtitle={t('aboutSubtitle')}
      />

      <Section title={t('aboutBuildTitle')} icon={Zap} delay={0.05}>
        <div className="legal-text">
          <p>{t('aboutBuildP1')}</p>
          <p>{t('aboutBuildP2')}</p>
        </div>
      </Section>

      <Section title={t('aboutHowTitle')} icon={Target} delay={0.1}>
        <div className="legal-text">
          <p>{t('aboutHowP1')}</p>
          <p>{t('aboutHowP2')}</p>
          <p>{t('aboutHowP3')}</p>
        </div>
      </Section>

      <Section title={t('aboutContactTitle')} icon={Mail} delay={0.15}>
        <div className="legal-text">
          <p>
            {t('aboutContactP1')}{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>.
          </p>
        </div>
      </Section>
    </main>
  )
}

export default About
