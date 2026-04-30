import { Check, Mail, Sparkles, Shield, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Try Hengam with a small team before you commit.',
    features: [
      'Up to 5 employees',
      '1 schedule generation per week',
      'Availability and target hours',
      'CSV export',
    ],
    cta: 'Start free',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$9',
    period: 'per month',
    description: 'For small businesses building weekly schedules every week.',
    features: [
      'Up to 25 employees',
      'Unlimited schedule generations',
      'Custom rules and coverage windows',
      'Schedule history',
      'CSV, PNG, and PDF exports',
      'Priority support',
    ],
    cta: 'Choose Pro',
    highlighted: true,
  },
  {
    name: 'Business',
    price: '$19',
    period: 'per month',
    description: 'For larger teams, multiple managers, and growing operations.',
    features: [
      'Unlimited employees',
      'Unlimited schedules',
      'Advanced rule support',
      'Multiple locations coming soon',
      'Dedicated setup help',
    ],
    cta: 'Contact us',
    highlighted: false,
  },
]

function PricingPage() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  function handlePlan() {
    navigate(currentUser ? '/dashboard' : '/signin')
  }

  return (
    <main className="app-page pricing-page">
      <PageHero
        eyebrow="Pricing"
        title="Simple plans for shift teams"
        subtitle="Start free, then upgrade when Hengam becomes part of your weekly scheduling rhythm."
      >
        <div className="page-hero-actions">
          <button className="settings-button" onClick={() => navigate(currentUser ? '/dashboard' : '/signin')}>
            <Sparkles size={16} />
            <span>{currentUser ? 'Go to dashboard' : 'Sign in to start'}</span>
          </button>
        </div>
      </PageHero>

      <section className="pricing-page-grid">
        {PLANS.map(plan => (
          <article
            key={plan.name}
            className={`pricing-page-card ${plan.highlighted ? 'pricing-page-card-featured' : ''}`}
          >
            {plan.highlighted && <div className="pricing-page-badge">Best for most teams</div>}
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

            {plan.name === 'Business' ? (
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

      <Section title="What every plan includes" icon={Shield} delay={0.05}>
        <div className="pricing-includes">
          <div>
            <h3>Constraint checks</h3>
            <p>Availability, roles, target hours, time off, and clopening rules are checked before a schedule is saved.</p>
          </div>
          <div>
            <h3>Plain-English rules</h3>
            <p>Managers can describe coverage needs and preferences in normal language.</p>
          </div>
          <div>
            <h3>Clear issues</h3>
            <p>If a week cannot work, Hengam explains what is missing instead of pretending everything is fine.</p>
          </div>
        </div>
      </Section>
    </main>
  )
}

export default PricingPage
