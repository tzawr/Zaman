import { Check, Sparkles, Shield, Zap } from 'lucide-react'
import { motion as Motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import Section from '../components/Section'
import { useI18n } from '../i18n'

function PricingPage() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { t } = useI18n()

  const plans = [
    {
      id: 'free',
      name: t('tierFree'),
      price: '$0',
      period: t('priceForever'),
      annualNote: null,
      description: t('priceFreeDesc'),
      features: [
        t('priceUpTo5'),
        t('priceOneSchedule'),
        t('priceManagerAvailability'),
        t('priceScheduleReview'),
        t('priceCsvExport'),
        t('price2WeeksHistory'),
      ],
      cta: t('priceFreeCta'),
      highlighted: false,
    },
    {
      id: 'pro',
      name: t('tierPro'),
      price: '$29',
      period: t('priceMonthly'),
      annualNote: t('priceAnnualNote'),
      description: t('priceProDesc'),
      features: [
        t('priceUnlimitedEmployees'),
        t('priceUnlimitedSchedules'),
        t('priceRuleParsing'),
        t('priceSmartRecommendations'),
        t('priceEmployeePortal'),
        t('priceAllExports'),
        t('priceUnlimitedHistory'),
        t('priceSpeechInput'),
        t('priceEmailSupport'),
      ],
      cta: t('priceProCta'),
      highlighted: true,
    },
  ]

  function handlePlan() {
    navigate(currentUser ? '/dashboard' : '/signin')
  }

  return (
    <main className="app-page pricing-page">
      <PageHero
        eyebrow={t('pricingPageEyebrow')}
        title={t('pricingPageTitle')}
        subtitle={t('pricingPageSubtitle')}
      >
        <div className="page-hero-actions">
          <button className="settings-button" onClick={() => navigate(currentUser ? '/dashboard' : '/signin')}>
            <Sparkles size={16} />
            <span>{currentUser ? t('pricingGoDashboard') : t('pricingSignInStart')}</span>
          </button>
        </div>
      </PageHero>

      <section className="pricing-page-grid">
        {plans.map((plan, i) => (
          <Motion.article
            key={plan.id}
            className={`pricing-page-card ${plan.highlighted ? 'pricing-page-card-featured' : ''}`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: i * 0.1 }}
          >
            {plan.highlighted && <div className="pricing-page-badge">{t('pricingBest')}</div>}
            <div className="pricing-page-plan">{plan.name}</div>
            <div className="pricing-page-price">
              <span>{plan.price}</span>
              <small>{plan.period}</small>
            </div>
            {plan.annualNote && <p className="pricing-page-annual">{plan.annualNote}</p>}
            <p className="pricing-page-desc">{plan.description}</p>

            <ul className="pricing-page-features">
              {plan.features.map(feature => (
                <li key={feature}>
                  <Check size={15} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <button
              className={plan.highlighted ? 'landing-cta-primary pricing-page-cta' : 'landing-cta-ghost pricing-page-cta'}
              onClick={handlePlan}
            >
              <Zap size={15} />
              <span>{plan.cta}</span>
            </button>
          </Motion.article>
        ))}
      </section>

      <p className="pricing-cancel-note">{t('pricingCancelNote')}</p>

      <Section title={t('pricingIncludesTitle')} icon={Shield} delay={0.05}>
        <div className="pricing-includes">
          <div>
            <h3>{t('pricingIncludeChecksTitle')}</h3>
            <p>{t('pricingIncludeChecksCopy')}</p>
          </div>
          <div>
            <h3>{t('pricingIncludeRulesTitle')}</h3>
            <p>{t('pricingIncludeRulesCopy')}</p>
          </div>
          <div>
            <h3>{t('pricingIncludeIssuesTitle')}</h3>
            <p>{t('pricingIncludeIssuesCopy')}</p>
          </div>
        </div>
      </Section>
    </main>
  )
}

export default PricingPage
