import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView, useMotionValue, animate } from 'framer-motion'
import { 
  ArrowRight, 
  Sparkles, 
  Clock, 
  Users, 
  Calendar, 
  Zap, 
  Shield, 
  Brain,
  Check,
  MessageSquare,
  TrendingUp
} from 'lucide-react'
import { useAuth } from '../AuthContext'

function Landing() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  function handleCTA() {
    if (currentUser) navigate('/dashboard')
    else navigate('/signup')
  }

  return (
    <div className="landing">
      <Hero onCTA={handleCTA} isSignedIn={!!currentUser} />
      <SocialProof />
      <HowItWorks />
      <Features />
      <StatsSection />
      <Pricing onCTA={handleCTA} />
      <FinalCTA onCTA={handleCTA} />
    </div>
  )
}

// ========== HERO ==========
function Hero({ onCTA, isSignedIn }) {
  const containerRef = useRef(null)
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  function handleMouseMove(e) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    mouseX.set(e.clientX - rect.left - rect.width / 2)
    mouseY.set(e.clientY - rect.top - rect.height / 2)
  }

  return (
    <section 
      ref={containerRef}
      className="landing-hero"
      onMouseMove={handleMouseMove}
    >
      <div className="landing-mesh">
        <motion.div 
          className="landing-blob landing-blob-1"
          animate={{ 
            x: [0, 40, -20, 0],
            y: [0, -30, 20, 0],
            scale: [1, 1.1, 0.95, 1]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="landing-blob landing-blob-2"
          animate={{ 
            x: [0, -50, 30, 0],
            y: [0, 20, -30, 0],
            scale: [1, 0.9, 1.15, 1]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="landing-blob landing-blob-3"
          animate={{ 
            x: [0, 30, -40, 0],
            y: [0, -20, 30, 0],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="landing-grid-overlay" />

      <div className="landing-hero-content">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="landing-eyebrow"
        >
          <Sparkles size={14} />
          <span>AI scheduling, reimagined</span>
        </motion.div>

        <motion.h1 
          className="landing-hero-title"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
        >
          Stop wasting hours
          <br />
          <span className="landing-gradient-text">building schedules.</span>
        </motion.h1>

        <motion.p 
          className="landing-hero-subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
        >
          Zaman is the AI scheduling assistant for shift managers. 
          Add your team, set availability, and let AI build your week 
          in seconds — not hours.
        </motion.p>

        <motion.div 
          className="landing-hero-actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
        >
          <button className="landing-cta-primary" onClick={onCTA}>
            <span>{isSignedIn ? 'Go to dashboard' : 'Get started — free'}</span>
            <ArrowRight size={18} />
          </button>
          <button 
            className="landing-cta-ghost"
            onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
          >
            See how it works
          </button>
        </motion.div>

        <motion.div 
          className="landing-hero-meta"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.6 }}
        >
          <div className="landing-meta-item">
            <Check size={14} />
            <span>No credit card required</span>
          </div>
          <div className="landing-meta-item">
            <Check size={14} />
            <span>Built for small teams</span>
          </div>
          <div className="landing-meta-item">
            <Check size={14} />
            <span>Free forever tier</span>
          </div>
        </motion.div>

        <motion.div 
          className="landing-hero-mockup"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4, ease: 'easeOut' }}
        >
          <MockupCard />
        </motion.div>
      </div>
    </section>
  )
}

function MockupCard() {
  return (
    <div className="mockup-window">
      <div className="mockup-header">
        <div className="mockup-dots">
          <span></span><span></span><span></span>
        </div>
        <div className="mockup-url">zaman.app/schedule</div>
      </div>
      <div className="mockup-body">
        <div className="mockup-title-row">
          <div className="mockup-title">Week of April 28</div>
          <div className="mockup-badge">
            <Sparkles size={12} />
            <span>AI generated</span>
          </div>
        </div>

        <div className="mockup-schedule">
          <div className="mockup-day">
            <div className="mockup-day-label">Mon</div>
            <div className="mockup-shifts">
              <div className="mockup-shift mockup-shift-purple">
                <span>Sam</span>
                <span className="mockup-time">6a — 2p</span>
              </div>
              <div className="mockup-shift mockup-shift-blue">
                <span>Alex</span>
                <span className="mockup-time">2p — 10p</span>
              </div>
            </div>
          </div>
          <div className="mockup-day">
            <div className="mockup-day-label">Tue</div>
            <div className="mockup-shifts">
              <div className="mockup-shift mockup-shift-pink">
                <span>Jamie</span>
                <span className="mockup-time">5a — 1p</span>
              </div>
              <div className="mockup-shift mockup-shift-purple">
                <span>Sam</span>
                <span className="mockup-time">1p — 9p</span>
              </div>
            </div>
          </div>
          <div className="mockup-day">
            <div className="mockup-day-label">Wed</div>
            <div className="mockup-shifts">
              <div className="mockup-shift mockup-shift-blue">
                <span>Alex</span>
                <span className="mockup-time">6a — 2p</span>
              </div>
              <div className="mockup-shift mockup-shift-pink">
                <span>Jamie</span>
                <span className="mockup-time">2p — 10p</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ========== SOCIAL PROOF ==========
function SocialProof() {
  return (
    <section className="landing-social">
      <p className="landing-social-label">Built for teams in</p>
      <div className="landing-social-grid">
        {['Restaurants', 'Cafés', 'Retail', 'Salons', 'Gyms', 'Small Biz'].map((label, i) => (
          <motion.div
            key={label}
            className="landing-social-chip"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
          >
            {label}
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ========== HOW IT WORKS ==========
function HowItWorks() {
  const steps = [
    {
      icon: Users,
      title: 'Add your team',
      description: 'Add employees, their roles, target hours, and weekly availability. Takes 2 minutes per person.',
    },
    {
      icon: Calendar,
      title: 'Set your rules',
      description: 'Operating hours, coverage minimums, time off requests, and custom scheduling rules.',
    },
    {
      icon: Sparkles,
      title: 'AI builds your week',
      description: 'Claude analyzes every constraint and generates a schedule in seconds. Review, tweak, publish.',
    },
  ]

  return (
    <section id="how-it-works" className="landing-section">
      <SectionHeader 
        eyebrow="How it works"
        title="From chaos to schedule in minutes"
        description="Three steps. Zero spreadsheets. Real AI that respects your constraints."
      />

      <div className="landing-steps">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            className="landing-step"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }}
          >
            <div className="landing-step-number">{String(i + 1).padStart(2, '0')}</div>
            <div className="landing-step-icon">
              <step.icon size={24} />
            </div>
            <h3 className="landing-step-title">{step.title}</h3>
            <p className="landing-step-desc">{step.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ========== FEATURES ==========
function Features() {
  const features = [
    {
      icon: Brain,
      title: 'Real AI reasoning',
      description: 'Powered by Claude — not dumb templates. Understands availability, time off, roles, and custom rules.',
    },
    {
      icon: Clock,
      title: 'Hours, not blocks',
      description: 'Set exact hours for each person each day. "Sam Monday 4am–9pm, Tuesday 10am–11pm."',
    },
    {
      icon: Shield,
      title: 'Clopening prevention',
      description: 'No more closing at 10pm and opening at 6am. AI enforces minimum gaps between shifts.',
    },
    {
      icon: MessageSquare,
      title: 'Prompt anything',
      description: '"Put Sam and Alex together Monday." "Jamie is training a new hire." Just type it.',
    },
    {
      icon: TrendingUp,
      title: 'Target hours',
      description: 'Set each person\'s target hours per week. AI distributes fairly and flags over-scheduling.',
    },
    {
      icon: Zap,
      title: 'Seconds, not hours',
      description: 'Generate a full week schedule in under 30 seconds. Regenerate with new rules instantly.',
    },
  ]

  return (
    <section className="landing-section">
      <SectionHeader 
        eyebrow="Features"
        title="Everything a shift manager needs"
        description="No fluff. No bloat. Just the features that actually save you hours every week."
      />

      <div className="landing-features-grid">
        {features.map((feature, i) => (
          <FeatureCard key={i} feature={feature} index={i} />
        ))}
      </div>
    </section>
  )
}

function FeatureCard({ feature, index }) {
  const ref = useRef(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })

  function handleMouseMove(e) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = (e.clientX - cx) / (rect.width / 2)
    const dy = (e.clientY - cy) / (rect.height / 2)
    setTilt({ x: dy * -4, y: dx * 4 })
  }

  function handleMouseLeave() {
    setTilt({ x: 0, y: 0 })
  }

  return (
    <motion.div
      ref={ref}
      className="landing-feature"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, delay: index * 0.05, ease: 'easeOut' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: 'transform 0.2s ease-out'
      }}
    >
      <div className="landing-feature-icon">
        <feature.icon size={22} />
      </div>
      <h3 className="landing-feature-title">{feature.title}</h3>
      <p className="landing-feature-desc">{feature.description}</p>
    </motion.div>
  )
}

// ========== STATS ==========
function StatsSection() {
  const stats = [
    { value: 30, suffix: 'sec', label: 'Average schedule generation time' },
    { value: 8, suffix: 'hrs', label: 'Saved per manager per week' },
    { value: 100, suffix: '%', label: 'Respects availability — always' },
  ]

  return (
    <section className="landing-section landing-stats-section">
      <div className="landing-stats-grid">
        {stats.map((stat, i) => (
          <StatCard key={i} stat={stat} index={i} />
        ))}
      </div>
    </section>
  )
}

function StatCard({ stat, index }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-100px' })
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView) return
    const controls = animate(0, stat.value, {
      duration: 1.5,
      ease: 'easeOut',
      onUpdate: (v) => setValue(Math.round(v))
    })
    return () => controls.stop()
  }, [inView, stat.value])

  return (
    <motion.div
      ref={ref}
      className="landing-stat"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay: index * 0.1 }}
    >
      <div className="landing-stat-value">
        <span className="landing-stat-number">{value}</span>
        <span className="landing-stat-suffix">{stat.suffix}</span>
      </div>
      <p className="landing-stat-label">{stat.label}</p>
    </motion.div>
  )
}

// ========== PRICING ==========
function Pricing({ onCTA }) {
  const tiers = [
    {
      name: 'Free',
      price: '$0',
      period: 'forever',
      description: 'Perfect for testing with your team.',
      features: [
        'Up to 5 employees',
        '1 schedule generation per week',
        'Basic AI scheduling',
        'Email support',
      ],
      cta: 'Start free',
      highlighted: false,
    },
    {
      name: 'Pro',
      price: '$9',
      period: 'per month',
      description: 'For growing small businesses.',
      features: [
        'Up to 25 employees',
        'Unlimited schedule generations',
        'Custom AI instructions',
        'Schedule history',
        'Priority support',
      ],
      cta: 'Start Pro',
      highlighted: true,
    },
    {
      name: 'Business',
      price: '$19',
      period: 'per month',
      description: 'For bigger teams and chains.',
      features: [
        'Unlimited employees',
        'Unlimited everything',
        'Advanced rules & constraints',
        'Multiple locations (coming)',
        'Dedicated support',
      ],
      cta: 'Contact us',
      highlighted: false,
    },
  ]

  return (
    <section className="landing-section">
      <SectionHeader 
        eyebrow="Pricing"
        title="Simple pricing. No surprises."
        description="Start free. Upgrade when you're ready."
      />

      <div className="landing-pricing-grid">
        {tiers.map((tier, i) => (
          <motion.div
            key={tier.name}
            className={`landing-pricing-card ${tier.highlighted ? 'landing-pricing-highlighted' : ''}`}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            {tier.highlighted && (
              <div className="landing-pricing-badge">Most popular</div>
            )}
            <div className="landing-pricing-name">{tier.name}</div>
            <div className="landing-pricing-price">
              <span className="landing-pricing-amount">{tier.price}</span>
              <span className="landing-pricing-period">/ {tier.period}</span>
            </div>
            <p className="landing-pricing-desc">{tier.description}</p>
            <ul className="landing-pricing-features">
              {tier.features.map(feat => (
                <li key={feat}>
                  <Check size={16} />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
            <button 
  className={tier.highlighted ? 'landing-cta-primary' : 'landing-cta-ghost'}
  onClick={() => {
    if (tier.name === 'Business') {
      window.location.href = 'mailto:contact@zamanapp.com?subject=Zaman Business inquiry'
    } else {
      onCTA()
    }
  }}
>
  {tier.cta}
</button>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ========== FINAL CTA ==========
function FinalCTA({ onCTA }) {
  return (
    <section className="landing-final">
      <div className="landing-final-glow"></div>
      <motion.div
        className="landing-final-content"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.7 }}
      >
        <h2 className="landing-final-title">
          Ready to stop dreading scheduling?
        </h2>
        <p className="landing-final-subtitle">
          Join teams using Zaman to build better schedules in less time.
        </p>
        <button className="landing-cta-primary landing-cta-large" onClick={onCTA}>
          <span>Get started — free</span>
          <ArrowRight size={20} />
        </button>
      </motion.div>
    </section>
  )
}

// ========== SECTION HEADER ==========
function SectionHeader({ eyebrow, title, description }) {
  return (
    <motion.div
      className="landing-section-header"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6 }}
    >
      <div className="landing-section-eyebrow">{eyebrow}</div>
      <h2 className="landing-section-title">{title}</h2>
      <p className="landing-section-desc">{description}</p>
    </motion.div>
  )
}

export default Landing