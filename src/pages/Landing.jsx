import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView, useMotionValue, animate, useScroll, useTransform } from 'framer-motion'
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
  TrendingUp,
  Star,
  Quote,
  ArrowUpRight,
  Play
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
    <div className="landing landing-v2">
      <CursorSpotlight />
      <Hero onCTA={handleCTA} isSignedIn={!!currentUser} />
      <MarqueeStrip />
      <HowItWorks />
      <PlaygroundDemo />
      <Features />
      <StatsSection />
      <Testimonials />
      <Pricing onCTA={handleCTA} />
      <FinalCTA onCTA={handleCTA} />
    </div>
  )
}

// ========== CURSOR SPOTLIGHT (follows mouse globally) ==========
function CursorSpotlight() {
  const [pos, setPos] = useState({ x: 50, y: 50 })

  useEffect(() => {
    function handleMove(e) {
      setPos({ 
        x: (e.clientX / window.innerWidth) * 100, 
        y: (e.clientY / window.innerHeight) * 100 
      })
    }
    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [])

  return (
    <div 
      className="cursor-spotlight"
      style={{ 
        background: `radial-gradient(600px at ${pos.x}% ${pos.y}%, rgba(99, 102, 241, 0.08), transparent 60%)` 
      }}
    />
  )
}

// ========== HERO ==========
function Hero({ onCTA, isSignedIn }) {
  const containerRef = useRef(null)
  const { scrollYProgress } = useScroll({ 
    target: containerRef,
    offset: ['start start', 'end start']
  })
  
  const titleY = useTransform(scrollYProgress, [0, 1], [0, 100])
  const titleOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
  const mockupY = useTransform(scrollYProgress, [0, 1], [0, 200])
  const mockupRotate = useTransform(scrollYProgress, [0, 1], [6, 0])

  return (
    <section ref={containerRef} className="landing-hero hero-v2">
      <div className="landing-mesh">
        <motion.div 
          className="landing-blob landing-blob-1"
          animate={{ x: [0, 60, -30, 0], y: [0, -40, 30, 0], scale: [1, 1.15, 0.9, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="landing-blob landing-blob-2"
          animate={{ x: [0, -70, 40, 0], y: [0, 30, -40, 0], scale: [1, 0.85, 1.2, 1] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="landing-blob landing-blob-3"
          animate={{ x: [0, 50, -60, 0], y: [0, -30, 40, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="landing-grid-overlay" />
      <FloatingShapes />

      <motion.div 
        className="landing-hero-content"
        style={{ y: titleY, opacity: titleOpacity }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="landing-eyebrow eyebrow-v2"
        >
          <span className="eyebrow-dot" />
          <Sparkles size={13} />
          <span>AI scheduling, reimagined</span>
        </motion.div>

        <motion.h1 
          className="landing-hero-title hero-title-v2"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="hero-line">Stop wasting hours</span>
          <span className="hero-line">
            <TypingText text="building schedules." className="landing-gradient-text" delay={800} />
          </span>
        </motion.h1>

        <motion.p 
          className="landing-hero-subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
        >
          Zaman is the AI scheduling assistant for shift managers. 
          Add your team, set availability, and let AI build your week 
          in seconds — not hours.
        </motion.p>

        <motion.div 
          className="landing-hero-actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
        >
          <button className="landing-cta-primary cta-glow" onClick={onCTA}>
            <span>{isSignedIn ? 'Go to dashboard' : 'Get started — free'}</span>
            <ArrowRight size={18} />
          </button>
          <button 
            className="landing-cta-ghost cta-watch"
            onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <Play size={14} fill="currentColor" />
            <span>See how it works</span>
          </button>
        </motion.div>

        <motion.div 
          className="landing-hero-meta"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.7 }}
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
      </motion.div>

      <motion.div 
        className="landing-hero-mockup"
        style={{ 
          y: mockupY,
          rotateX: mockupRotate
        }}
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.2, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <MockupCard />
      </motion.div>
    </section>
  )
}

// ========== TYPING ANIMATION ==========
function TypingText({ text, className, delay = 0 }) {
  const [displayed, setDisplayed] = useState('')
  
  useEffect(() => {
    let timeout
    const startTimeout = setTimeout(() => {
      let i = 0
      const interval = setInterval(() => {
        if (i <= text.length) {
          setDisplayed(text.slice(0, i))
          i++
        } else {
          clearInterval(interval)
        }
      }, 50)
      timeout = interval
    }, delay)
    return () => {
      clearTimeout(startTimeout)
      if (timeout) clearInterval(timeout)
    }
  }, [text, delay])
  
  return (
    <span className={className}>
      {displayed}
      <span className="typing-cursor">|</span>
    </span>
  )
}

// ========== FLOATING SHAPES ==========
function FloatingShapes() {
  return (
    <>
      <motion.div 
        className="floating-shape shape-circle"
        animate={{ y: [0, -30, 0], rotate: [0, 180, 360] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div 
        className="floating-shape shape-square"
        animate={{ y: [0, 20, 0], rotate: [0, -90, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div 
        className="floating-shape shape-triangle"
        animate={{ y: [0, -25, 0], rotate: [0, 120, 240] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
    </>
  )
}

function MockupCard() {
  return (
    <div className="mockup-window mockup-v2">
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
          {[
            { day: 'Mon', shifts: [{name: 'Sam', time: '6a — 2p', color: 'purple'}, {name: 'Alex', time: '2p — 10p', color: 'blue'}] },
            { day: 'Tue', shifts: [{name: 'Jamie', time: '5a — 1p', color: 'pink'}, {name: 'Sam', time: '1p — 9p', color: 'purple'}] },
            { day: 'Wed', shifts: [{name: 'Alex', time: '6a — 2p', color: 'blue'}, {name: 'Jamie', time: '2p — 10p', color: 'pink'}] },
          ].map((day, i) => (
            <motion.div 
              key={day.day} 
              className="mockup-day"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.4 + i * 0.1 }}
            >
              <div className="mockup-day-label">{day.day}</div>
              <div className="mockup-shifts">
                {day.shifts.map((s, j) => (
                  <div key={j} className={`mockup-shift mockup-shift-${s.color}`}>
                    <span>{s.name}</span>
                    <span className="mockup-time">{s.time}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ========== MARQUEE STRIP ==========
function MarqueeStrip() {
  const items = [
    'Restaurants', 'Coffee shops', 'Retail', 'Salons', 'Gyms', 'Bars', 
    'Bakeries', 'Boutiques', 'Studios', 'Clinics', 'Auto shops', 'Pet care'
  ]
  return (
    <section className="marquee-section">
      <p className="marquee-label">Built for teams in</p>
      <div className="marquee">
        <div className="marquee-track">
          {[...items, ...items].map((item, i) => (
            <span key={i} className="marquee-item">
              <span className="marquee-dot" />
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

// ========== HOW IT WORKS ==========
function HowItWorks() {
  const steps = [
    {
      icon: Users,
      number: '01',
      title: 'Add your team',
      description: 'Add employees, their roles, target hours, and weekly availability. Takes 2 minutes per person.',
    },
    {
      icon: Calendar,
      number: '02',
      title: 'Set your rules',
      description: 'Operating hours, coverage minimums, time off requests, and custom scheduling rules.',
    },
    {
      icon: Sparkles,
      number: '03',
      title: 'AI builds your week',
      description: 'Claude analyzes every constraint and generates a schedule in seconds. Review, tweak, publish.',
    },
  ]

  return (
    <section id="how-it-works" className="landing-section steps-section">
      <SectionHeader 
        eyebrow="How it works"
        title="From chaos to schedule in minutes"
        description="Three steps. Zero spreadsheets. Real AI that respects your constraints."
      />

      <div className="landing-steps steps-v2">
        <div className="steps-line" aria-hidden />
        {steps.map((step, i) => (
          <motion.div
            key={i}
            className="landing-step step-v2"
            initial={{ opacity: 0, y: 60 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="step-number-circle">
              <span>{step.number}</span>
            </div>
            <div className="landing-step-icon step-icon-v2">
              <step.icon size={22} />
            </div>
            <h3 className="landing-step-title">{step.title}</h3>
            <p className="landing-step-desc">{step.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ========== PLAYGROUND DEMO ==========
function PlaygroundDemo() {
  const [activeTab, setActiveTab] = useState('generate')
  
  const tabs = [
    { key: 'generate', label: 'Generate', icon: Sparkles },
    { key: 'edit', label: 'Edit', icon: MessageSquare },
    { key: 'export', label: 'Export', icon: ArrowUpRight },
  ]

  return (
    <section className="landing-section playground-section">
      <SectionHeader 
        eyebrow="Live preview"
        title="See it in action"
        description="Switch between the three things that make Zaman feel magical."
      />
      
      <motion.div 
        className="playground"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ duration: 0.7 }}
      >
        <div className="playground-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`playground-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <tab.icon size={14} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        
        <div className="playground-screen">
          {activeTab === 'generate' && (
            <motion.div 
              key="generate"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="playground-content"
            >
              <div className="playground-prompt">
                <Sparkles size={14} />
                <span>"Generate a balanced schedule for next week"</span>
              </div>
              <div className="playground-result">
                <div className="playground-loading">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
                <p>Claude analyzed 7 employees, 4 roles, 12 availability constraints, and built your week in 8 seconds.</p>
              </div>
            </motion.div>
          )}
          {activeTab === 'edit' && (
            <motion.div 
              key="edit"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="playground-content"
            >
              <div className="playground-edit-row">
                <div className="playground-shift purple">Sam · 6a-2p</div>
                <ArrowRight size={14} />
                <div className="playground-shift purple highlighted">Sam · 6a-3p (+1h)</div>
              </div>
              <p className="playground-caption">Click any shift, edit times, drag to swap people. Hours recalc instantly.</p>
            </motion.div>
          )}
          {activeTab === 'export' && (
            <motion.div 
              key="export"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="playground-content"
            >
              <div className="playground-formats">
                <div className="format-pill">CSV</div>
                <div className="format-pill">PNG</div>
                <div className="format-pill">PDF</div>
              </div>
              <p className="playground-caption">One click. Three formats. Send to your team however they prefer.</p>
            </motion.div>
          )}
        </div>
      </motion.div>
    </section>
  )
}

// ========== FEATURES ==========
function Features() {
  const features = [
    { icon: Brain, title: 'Real AI reasoning', description: 'Powered by Claude. Understands availability, time off, roles, and custom rules.' },
    { icon: Clock, title: 'Hours, not blocks', description: 'Set exact hours per person per day. Sam Mon 4am-9pm, Tue 10am-11pm.' },
    { icon: Shield, title: 'Clopening prevention', description: 'No more closing at 10pm and opening at 6am. Min gaps enforced automatically.' },
    { icon: MessageSquare, title: 'Prompt anything', description: '"Put Sam and Alex together Monday." "Jamie is training a new hire." Just type.' },
    { icon: TrendingUp, title: 'Target hours', description: 'Set each person\'s target. AI distributes fairly and flags over-scheduling.' },
    { icon: Zap, title: 'Seconds, not hours', description: 'Generate a full week in under 30 seconds. Regenerate with new rules instantly.' },
  ]

  return (
    <section className="landing-section">
      <SectionHeader 
        eyebrow="Features"
        title="Everything a shift manager needs"
        description="No fluff. No bloat. Just the features that actually save you hours every week."
      />
      <div className="landing-features-grid features-v2">
        {features.map((feature, i) => (
          <FeatureCard key={i} feature={feature} index={i} />
        ))}
      </div>
    </section>
  )
}

function FeatureCard({ feature, index }) {
  const ref = useRef(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0, glow: { x: 50, y: 50 } })

  function handleMouseMove(e) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = (e.clientX - cx) / (rect.width / 2)
    const dy = (e.clientY - cy) / (rect.height / 2)
    setTilt({ 
      x: dy * -5, 
      y: dx * 5,
      glow: { 
        x: ((e.clientX - rect.left) / rect.width) * 100, 
        y: ((e.clientY - rect.top) / rect.height) * 100 
      }
    })
  }

  function handleMouseLeave() {
    setTilt({ x: 0, y: 0, glow: { x: 50, y: 50 } })
  }

  return (
    <motion.div
      ref={ref}
      className="landing-feature feature-v2"
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
      <div 
        className="feature-glow"
        style={{
          background: `radial-gradient(circle at ${tilt.glow.x}% ${tilt.glow.y}%, rgba(99, 102, 241, 0.15), transparent 60%)`
        }}
      />
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
    { value: 30, suffix: 'sec', label: 'Average schedule generation time', max: 60 },
    { value: 8, suffix: 'hrs', label: 'Saved per manager per week', max: 10 },
    { value: 100, suffix: '%', label: 'Respects availability — always', max: 100 },
  ]

  return (
    <section className="landing-section landing-stats-section">
      <div className="landing-stats-grid stats-v2">
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
  const [barWidth, setBarWidth] = useState(0)

  useEffect(() => {
    if (!inView) return
    const controls = animate(0, stat.value, {
      duration: 1.8,
      ease: 'easeOut',
      onUpdate: (v) => setValue(Math.round(v))
    })
    const barTimeout = setTimeout(() => {
      setBarWidth((stat.value / stat.max) * 100)
    }, 200)
    return () => {
      controls.stop()
      clearTimeout(barTimeout)
    }
  }, [inView, stat.value, stat.max])

  return (
    <motion.div
      ref={ref}
      className="landing-stat stat-v2"
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
      <div className="stat-bar">
        <div 
          className="stat-bar-fill" 
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </motion.div>
  )
}

// ========== TESTIMONIALS ==========
function Testimonials() {
  const testimonials = [
    {
      quote: "I used to spend 4 hours every Sunday building schedules. Now it's 15 minutes.",
      author: "Cafe Manager",
      role: "Coffee shop, 12 staff",
    },
    {
      quote: "The AI actually listens to my rules. No more weird shifts I have to fix manually.",
      author: "Restaurant Owner",
      role: "Bistro, 18 staff",
    },
    {
      quote: "Export to PDF saved my life. I just text the schedule image to everyone Sunday night.",
      author: "Retail Manager",
      role: "Boutique, 8 staff",
    },
  ]

  return (
    <section className="landing-section testimonials-section">
      <SectionHeader 
        eyebrow="What managers say"
        title="Built for the people who hate scheduling most"
        description="Early users have things to say."
      />
      
      <div className="testimonials-grid">
        {testimonials.map((t, i) => (
          <motion.div
            key={i}
            className="testimonial-card"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6, delay: i * 0.1 }}
          >
            <Quote size={24} className="testimonial-quote-icon" />
            <p className="testimonial-quote">{t.quote}</p>
            <div className="testimonial-author">
              <div className="testimonial-stars">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={12} fill="currentColor" />
                ))}
              </div>
              <div>
                <div className="testimonial-name">{t.author}</div>
                <div className="testimonial-role">{t.role}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
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
      features: ['Up to 5 employees', '1 schedule generation per week', 'Basic AI scheduling', 'Email support'],
      cta: 'Start free',
      highlighted: false,
    },
    {
      name: 'Pro',
      price: '$9',
      period: 'per month',
      description: 'For growing small businesses.',
      features: ['Up to 25 employees', 'Unlimited schedule generations', 'Custom AI instructions', 'Schedule history', 'Priority support'],
      cta: 'Start Pro',
      highlighted: true,
    },
    {
      name: 'Business',
      price: '$19',
      period: 'per month',
      description: 'For bigger teams and chains.',
      features: ['Unlimited employees', 'Unlimited everything', 'Advanced rules & constraints', 'Multiple locations (coming)', 'Dedicated support'],
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
            {tier.highlighted && <div className="landing-pricing-badge">Most popular</div>}
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
    <section className="landing-final final-v2">
      <div className="landing-final-glow"></div>
      <motion.div
        className="landing-final-content"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.7 }}
      >
        <h2 className="landing-final-title">Ready to stop dreading scheduling?</h2>
        <p className="landing-final-subtitle">
          Join teams using Zaman to build better schedules in less time.
        </p>
        <button className="landing-cta-primary landing-cta-large cta-glow" onClick={onCTA}>
          <span>Get started — free</span>
          <ArrowRight size={20} />
        </button>
      </motion.div>
    </section>
  )
}

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