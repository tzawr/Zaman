import { Check, Mail, Sparkles, Shield, Zap } from 'lucide-react'
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
      description: t('priceFreeDesc'),
      features: [t('priceUpTo5'), t('priceOneSchedule'), t('pricingIncludeChecksTitle'), t('priceCsvExport')],
      cta: t('priceFreeCta'),
      highlighted: false,
    },
    {
      id: 'pro',
      name: t('tierPro'),
      price: '$9',
      period: t('priceMonthly'),
      description: t('priceProDesc'),
      features: [t('priceUpTo25'), t('priceUnlimitedSchedules'), t('priceCustomRules'), t('priceHistory'), t('heroMeta3'), t('pricePriority')],
      cta: t('pricingChoosePro'),
      highlighted: true,
    },
    {
      id: 'business',
      name: t('tierBusiness'),
      price: '$19',
      period: t('priceMonthly'),
      description: t('priceBusinessDesc'),
      features: [t('priceUnlimitedEmployees'), t('priceUnlimitedSchedules'), t('priceAdvanced'), t('priceLocations'), t('priceDedicated')],
      cta: t('priceBusinessCta'),
      highlighted: false,
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
        {plans.map(plan => (
          <article
            key={plan.name}
            className={`pricing-page-card ${plan.highlighted ? 'pricing-page-card-featured' : ''}`}
          >
            {plan.highlighted && <div className="pricing-page-badge">{t('pricingBest')}</div>}
            <div className="pricing-page-plan">{plan.name}</div>
            <div className="pricing-page-price">
              <span>{plan.price}</span>
              <small>/ {plan.period}</small>
            </div>
            <p className="pricing-page-desc">{plan.description}</p>

            <ul className="pricing-page-features">
              {plan.features.map(feature => (
                <li key={feature}>
                  <Check size={16} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            {plan.id === 'business' ? (
              <a
                className="landing-cta-ghost pricing-page-cta"
                href="mailto:aliseyfiazadsa6@gmail.com?subject=Hengam Business plan"
              >
                <Mail size={16} />
                <span>{plan.cta}</span>
              </a>
            ) : (
              <button
                className={plan.highlighted ? 'landing-cta-primary pricing-page-cta' : 'landing-cta-ghost pricing-page-cta'}
                onClick={handlePlan}
              >
                <Zap size={16} />
                <span>{plan.cta}</span>
              </button>
            )}
          </article>
        ))}
      </section>

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
