import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
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
  ArrowUpRight,
  Play,
  AlertTriangle,
  Target
} from 'lucide-react'
import { useAuth } from '../AuthContext'

function Landing() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  void motion

  function handleCTA() {
    if (currentUser) navigate('/dashboard')
    else navigate('/signup')
  }

  return (
    <div className="landing landing-v2">
      <Hero onCTA={handleCTA} isSignedIn={!!currentUser} />
      <MarqueeStrip />
      <PremiumPanels />
      <HowItWorks />
      <TrustSection />
      <PlaygroundDemo />
      <Features />
      <Pricing onCTA={handleCTA} />
      <FinalCTA onCTA={handleCTA} />
    </div>
  )
}

// ========== HERO ==========
function Hero({ onCTA, isSignedIn }) {
  const containerRef = useRef(null)

  return (
    <section ref={containerRef} className="landing-hero hero-v2">
      <div className="landing-grid-overlay" />

      <motion.div 
        className="landing-hero-content"
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="landing-eyebrow eyebrow-v2"
        >
          <span className="eyebrow-dot" />
          <Sparkles size={13} />
          <span>AI rule parsing. Constraint-based scheduling.</span>
        </motion.div>

        <motion.h1 
          className="landing-hero-title hero-title-v2"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="hero-line">Build the week your</span>
          <span className="hero-line">team can actually work.</span>
        </motion.h1>

        <motion.p 
          className="landing-hero-subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
        >
          Hengam turns plain-English coverage rules, availability, time off,
          and target hours into a checked schedule with clear business tradeoffs.
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
            <span>Explains impossible weeks</span>
          </div>
          <div className="landing-meta-item">
            <Check size={14} />
            <span>Exports CSV, PNG, PDF</span>
          </div>
        </motion.div>

        <motion.div
          className="hero-proof-row"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.8, ease: 'easeOut' }}
        >
          <div>
            <strong>Rules</strong>
            <span>Plain English</span>
          </div>
          <div>
            <strong>Engine</strong>
            <span>Deterministic</span>
          </div>
          <div>
            <strong>Review</strong>
            <span>Explained gaps</span>
          </div>
        </motion.div>
      </motion.div>

      <motion.div 
        className="landing-hero-mockup"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="hero-preview-frame">
          <div className="hero-preview-topline">
            <span className="hero-preview-status" />
            <span>Checked schedule ready</span>
          </div>
          <MockupCard />
        </div>
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
  const days = [
    {
      day: 'Mon',
      shifts: [
        { name: 'Maya', role: 'Shift Supervisor', time: '4a - 11a', color: 'pink' },
        { name: 'Eli', role: 'Barista', time: '4a - 12p', color: 'red' },
        { name: 'Owen', role: 'Shift Supervisor', time: '12:30p - 8:30p', color: 'purple' },
      ],
    },
    {
      day: 'Tue',
      shifts: [
        { name: 'Maya', role: 'Shift Supervisor', time: '4a - 11a', color: 'pink' },
        { name: 'Noah', role: 'Barista', time: '5a - 11:30a', color: 'blue' },
        { name: 'Riley', role: 'Barista', time: '12:30p - 8p', color: 'red' },
      ],
    },
    {
      day: 'Wed',
      shifts: [
        { name: 'Owen', role: 'Shift Supervisor', time: '4a - 12p', color: 'purple' },
        { name: 'Sofia', role: 'Barista', time: '4a - 11a', color: 'pink' },
        { name: 'Theo', role: 'Shift Supervisor', time: '12p - 8p', color: 'pink' },
      ],
    },
    {
      day: 'Sun',
      shifts: [
        { name: 'Lena', role: 'Shift Supervisor', time: '4a - 12p', color: 'purple' },
        { name: 'Leo', role: 'Manager', time: '10a - 4p', color: 'green' },
        { name: 'Open shift', role: 'Barista', time: '12p - 3p', color: 'empty' },
      ],
    },
  ]

  return (
    <div className="mockup-window mockup-v2 product-proof">
      <div className="mockup-header">
        <div className="mockup-dots">
          <span></span><span></span><span></span>
        </div>
        <div className="mockup-url">hengam.app/schedule</div>
      </div>
      <div className="mockup-body">
        <div className="proof-layout">
          <aside className="proof-rules">
            <div className="proof-label">Manager rules</div>
            <div className="proof-rule">
              <Clock size={13} />
              <span>1 supervisor + 1 barista by 4am</span>
            </div>
            <div className="proof-rule">
              <Users size={13} />
              <span>Hit weekly target hours when possible</span>
            </div>
            <div className="proof-rule">
              <Shield size={13} />
              <span>No clopening or availability breaks</span>
            </div>
            <div className="proof-rule proof-warning">
              <AlertTriangle size={13} />
              <span>Leo is off two days, 10am-4pm only</span>
            </div>
          </aside>

          <div className="proof-schedule-wrap">
            <div className="mockup-title-row">
              <div>
                <div className="mockup-title">Week of May 4</div>
                <div className="proof-subtitle">Generated from constraints, then checked.</div>
              </div>
              <div className="mockup-badge">
                <Sparkles size={12} />
                <span>Ready to review</span>
              </div>
            </div>

            <div className="proof-week">
              {days.map((day, i) => (
                <motion.div
                  key={day.day}
                  className="proof-day"
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.25 + i * 0.08 }}
                >
                  <div className="mockup-day-label">{day.day}</div>
                  <div className="mockup-shifts">
                    {day.shifts.map((s, j) => (
                      <div key={j} className={`mockup-shift proof-shift mockup-shift-${s.color}`}>
                        <span>
                          <strong>{s.name}</strong>
                          <small>{s.role}</small>
                        </span>
                        <span className="mockup-time">{s.time}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="proof-bottom">
              <div className="proof-hours">
                <Target size={14} />
                <span>Leo: 30 / 40h</span>
              </div>
              <div className="proof-issue">
                <AlertTriangle size={14} />
                <span>Only 30h possible with current availability.</span>
              </div>
            </div>
          </div>
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
      <p className="marquee-label">Built for shift teams in</p>
      <div className="marquee">
        <div className="marquee-track">
          {items.map((item) => (
            <span key={item} className="marquee-item">
              <span className="marquee-dot" />
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function PremiumPanels() {
  useEffect(() => {
    const panels = document.querySelectorAll('.premium-panel')
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.28 }
    )

    panels.forEach(panel => observer.observe(panel))

    return () => observer.disconnect()
  }, [])

  const eventRows = [
    { time: '4 AM', title: 'Opening shift', status: 'ready', avatars: ['M', 'E'] },
    { time: '8 AM', title: 'Morning rush', status: 'active', avatars: ['N', 'S', 'A'] },
    { time: '12 PM', title: 'Coverage check', status: 'ready', avatars: ['L', 'R'] },
    { time: '3 PM', title: 'Coverage gap', status: 'gap', avatars: ['+'] },
  ]

  const ruleRows = [
    { label: 'Pairing', value: 'Mentors stay with trainees' },
    { label: 'Rest', value: 'No clopening' },
    { label: 'Hours', value: 'Weekly targets balanced' },
    { label: 'Review', value: 'Every gap explained' },
  ]

  const coverageStats = [
    { value: '4', label: 'coverage windows' },
    { value: '13', label: 'hour targets' },
    { value: '1', label: 'open gap' },
  ]

  const issueAdvice = [
    'Move a trained lead into the opening window',
    'Keep the low-risk afternoon coverage stable',
    'Publish with one clear open shift if unavailable',
  ]

  return (
    <section className="landing-section premium-panels-section">
      <SectionHeader
        eyebrow="Scheduling intelligence"
        title="The week, explained before anyone sees it"
        description="Hengam turns manager notes, coverage rules, availability, target hours, and validation results into one review-ready scheduling workflow."
      />

      <div className="premium-panel-grid">
        <motion.div
          className="premium-panel premium-panel-wide"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="premium-border-sweep" />
          <div className="premium-panel-copy">
            <h3>Coverage-aware schedule board</h3>
            <p>Openers, closers, pre-closers, staffing windows, and open gaps are visible before the schedule is published.</p>
          </div>
          <div className="premium-coverage-stats" aria-hidden="true">
            {coverageStats.map(stat => (
              <span key={stat.label}>
                <strong>{stat.value}</strong>
                <small>{stat.label}</small>
              </span>
            ))}
          </div>
          <div className="premium-coverage-health" aria-hidden="true">
            <span>Mon opening covered</span>
            <span>Targets balanced</span>
            <span>1 manager review</span>
          </div>
          <div className="premium-calendar-scene" aria-hidden="true">
            <div className="premium-calendar-card">
              <div className="premium-calendar-head">
                <span>May</span>
                <strong>04 - 10</strong>
              </div>
              <div className="premium-calendar-grid">
                {Array.from({ length: 28 }).map((_, i) => (
                  <span key={i} className={i === 11 ? 'active' : i % 6 === 0 ? 'muted' : ''}>{i + 1}</span>
                ))}
              </div>
            </div>
            <div className="premium-timeline">
              <div className="premium-now-line">
                <span>8:50 AM</span>
                <i />
              </div>
              {eventRows.map((event, index) => (
                <div key={event.time} className={`premium-event-row is-${event.status}`} style={{ '--i': index }}>
                  <span className="premium-event-time">{event.time}</span>
                  <article className="premium-event-chip">
                    <div>
                      <strong>{event.title}</strong>
                      <small>{event.status === 'gap' ? 'Needs one more person' : 'Role coverage checked'}</small>
                    </div>
                    <span className="premium-avatars" aria-hidden="true">
                      {event.avatars.map((avatar, avatarIndex) => (
                        <b key={`${event.title}-${avatarIndex}`}>{avatar}</b>
                      ))}
                    </span>
                  </article>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          className="premium-panel premium-panel-stack"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.65, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="premium-border-sweep" />
          <div className="premium-panel-copy">
            <h3>Plain English becomes constraints</h3>
            <p>Managers can type or speak rules. Hengam parses them once, then the scheduler follows them deterministically.</p>
          </div>
          <div className="premium-rule-input-demo" aria-hidden="true">
            <div className="premium-rule-input-box">
              <span>Manager note</span>
              <p>No clopening. Pair trainees with mentors. Hit weekly targets before adding extra coverage.</p>
            </div>
            <div className="premium-parser-line">
              <Sparkles size={14} />
              <span>Parsing rules into constraints</span>
              <i />
              <i />
              <i />
            </div>
            <div className="premium-parsed-pills">
            {ruleRows.map((item, index) => (
              <span key={item.label} style={{ '--i': index }}>
                <Check size={13} />
                <strong>{item.label}</strong>
                <small>{item.value}</small>
              </span>
            ))}
            </div>
            <div className="premium-ready-status">
              <Target size={14} />
              <span>Ready for deterministic scheduler</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          className="premium-panel"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.65, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="premium-border-sweep" />
          <div className="premium-panel-copy">
            <h3>Professional issue language</h3>
            <p>Validation problems are translated into manager-friendly business advice, not scary raw errors.</p>
          </div>
          <div className="premium-demo-group">
            <div className="premium-note-card" aria-hidden="true">
              <AlertTriangle size={15} />
              <span>Saturday opening needs a shift lead. Try moving an available lead from a lower-risk window.</span>
            </div>
            <div className="premium-typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="premium-advice-list" aria-hidden="true">
              {issueAdvice.map((advice, index) => (
                <span key={advice} style={{ '--i': index }}>
                  <Check size={12} />
                  {advice}
                </span>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          className="premium-panel"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.65, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="premium-border-sweep" />
          <div className="premium-panel-copy">
            <h3>History, exports, and review</h3>
            <p>Save generated weeks, compare versions, and export clean schedules for the team.</p>
          </div>
          <div className="premium-demo-group">
            <div className="premium-document-stack" aria-hidden="true">
              <div className="premium-doc doc-back" />
              <div className="premium-doc doc-mid" />
              <div className="premium-doc doc-front">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="premium-export-row" aria-hidden="true">
              <button type="button">CSV</button>
              <button type="button">PNG</button>
              <button type="button">PDF</button>
            </div>
          </div>
        </motion.div>
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
      title: 'Hengam builds your week',
      description: 'Hengam analyzes every constraint and generates a schedule in seconds. Review, tweak, publish.',
    },
  ]

  return (
    <section id="how-it-works" className="landing-section steps-section">
      <SectionHeader 
        eyebrow="How it works"
        title="From rules to a checked schedule"
        description="Hengam turns plain English and employee availability into a schedule with clear tradeoffs."
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

// ========== TRUST SECTION ==========
function TrustSection() {
  const checks = [
    {
      label: 'Hard rules',
      items: ['Correct roles', 'Availability windows', 'Time off', 'One shift per day'],
    },
    {
      label: 'Coverage',
      items: ['Openers', 'Closers', 'Minimum staffing', 'Pre-closing shifts'],
    },
    {
      label: 'Fairness',
      items: ['Target hours', 'Fewer short shifts', 'Under/over warnings', 'Explainable gaps'],
    },
  ]

  return (
    <section className="landing-section trust-section">
      <div className="trust-panel">
        <div className="trust-copy">
          <div className="landing-section-eyebrow">Why managers trust it</div>
          <h2 className="landing-section-title">It does not pretend impossible weeks are solved.</h2>
          <p className="landing-section-desc">
            Hengam separates understanding from scheduling: AI reads the manager’s rules,
            deterministic code builds the week, and the validator explains the remaining conflicts.
          </p>
        </div>

        <div className="trust-checks">
          {checks.map(group => (
            <div className="trust-check-group" key={group.label}>
              <div className="trust-check-label">{group.label}</div>
              {group.items.map(item => (
                <div className="trust-check-item" key={item}>
                  <Check size={14} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ========== PLAYGROUND DEMO ==========
function PlaygroundDemo() {
  const [openQuestion, setOpenQuestion] = useState(0)

  const questions = [
    {
      question: 'Does Hengam replace the manager’s judgment?',
      answer: 'No. Hengam drafts the week, checks the constraints, and explains problems. The manager can still edit shifts, override decisions, and publish only when the schedule looks right.',
    },
    {
      question: 'Can employees enter their own availability?',
      answer: 'Yes. Managers can invite employees to a portal where they add availability and time off. Managers can also keep control and enter availability themselves.',
    },
    {
      question: 'What happens when the week is impossible?',
      answer: 'Hengam does not hide it. It shows review items and recommendations, such as missing opening coverage, unavailable people, or target-hour gaps.',
    },
    {
      question: 'Can I give instructions in normal language?',
      answer: 'Yes. You can type rules like “Ali is training Nura, put them together” or “Amir should have shorter 4-hour shifts,” and Hengam turns them into scheduling constraints.',
    },
    {
      question: 'Can I still export and share the schedule?',
      answer: 'Yes. Finished schedules can be saved in history and exported for sharing with the team.',
    },
  ]

  return (
    <section className="landing-section playground-section">
      <SectionHeader 
        eyebrow="Questions & answers"
        title="What managers usually ask first"
        description="Straight answers about control, employee availability, and what happens when a week cannot work."
      />
      
      <motion.div 
        className="landing-qa-panel"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ duration: 0.7 }}
      >
        <div className="landing-qa-list">
          {questions.map((item, index) => {
            const isOpen = openQuestion === index
            return (
            <button
              key={item.question}
              type="button"
              className={`landing-qa-item ${isOpen ? 'active' : ''}`}
              onClick={() => setOpenQuestion(isOpen ? -1 : index)}
            >
              <span className="landing-qa-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="landing-qa-copy">
                <strong>{item.question}</strong>
                {isOpen && <span>{item.answer}</span>}
              </span>
              <ArrowRight size={16} className="landing-qa-arrow" />
            </button>
          )})}
        </div>
        <div className="landing-qa-aside">
          <MessageSquare size={18} />
          <span>Have a workflow question? Hengam is built around manager review, not auto-publishing.</span>
        </div>
      </motion.div>
    </section>
  )
}

// ========== FEATURES ==========
function Features() {
  const features = [
    { icon: Brain, title: 'Plain-English rules', description: 'Type coverage needs, pairing rules, time-off notes, and manager preferences.' },
    { icon: Clock, title: 'Real shift windows', description: 'Handle opens, closes, pre-closes, minimum staffing windows, and custom hours.' },
    { icon: Shield, title: 'Hard checks', description: 'Availability, roles, target hours, time off, and clopening rules are checked before saving.' },
    { icon: AlertTriangle, title: 'Impossible weeks explained', description: 'When the week cannot work, Hengam tells you exactly what blocked it.' },
    { icon: TrendingUp, title: 'Target hours', description: "Set each person's weekly target and see who is under, over, or on track." },
    { icon: Zap, title: 'Fast drafts', description: 'Generate multiple schedule variants locally after the rules are understood.' },
  ]

  return (
    <section className="landing-section">
      <SectionHeader 
        eyebrow="Features"
        title="The boring reliability managers need"
        description="AI helps understand the request. The scheduler handles the math."
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
          background: `radial-gradient(circle at ${tilt.glow.x}% ${tilt.glow.y}%, rgba(96, 165, 250, 0.16), transparent 60%)`
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

// ========== PRICING ==========
function Pricing({ onCTA }) {
  const tiers = [
    {
      name: 'Free',
      price: '$0',
      period: 'forever',
      description: 'Perfect for testing with your team.',
      features: ['Up to 5 employees', '1 schedule generation per week', 'Basic scheduling', 'Email support'],
      cta: 'Start free',
      highlighted: false,
    },
    {
      name: 'Pro',
      price: '$9',
      period: 'per month',
      description: 'For growing small businesses.',
      features: ['Up to 25 employees', 'Unlimited schedule generations', 'Custom scheduling rules', 'Schedule history', 'Priority support'],
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
                  window.location.href = 'mailto:contact@hengamapp.com?subject=Hengam Business inquiry'
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
          Join teams using Hengam to build better schedules in less time.
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
