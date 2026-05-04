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
import { useI18n } from '../i18n'

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
  const { t, isRtl } = useI18n()

  return (
    <section ref={containerRef} className="landing-hero hero-v2">
      <div className="landing-grid-overlay" />

      <motion.div 
        className="landing-hero-content"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="landing-eyebrow eyebrow-v2"
        >
          <span className="eyebrow-dot" />
          <Sparkles size={13} />
          <span>{t('heroEyebrow')}</span>
        </motion.div>

        <motion.h1 
          className="landing-hero-title hero-title-v2"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="hero-line">{t('heroTitle1')}</span>
          <span className="hero-line">{t('heroTitle2')}</span>
        </motion.h1>

        <motion.p 
          className="landing-hero-subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
        >
          {t('heroSubtitle')}
        </motion.p>

        <motion.div 
          className="landing-hero-actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
        >
          <button className="landing-cta-primary cta-glow" onClick={onCTA}>
            <span>{isSignedIn ? t('heroCtaIn') : t('heroCtaOut')}</span>
            <ArrowRight size={18} />
          </button>
          <button 
            className="landing-cta-ghost cta-watch"
            onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <Play size={14} fill="currentColor" />
            <span>{t('heroWatch')}</span>
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
            <span>{t('heroMeta1')}</span>
          </div>
          <div className="landing-meta-item">
            <Check size={14} />
            <span>{t('heroMeta2')}</span>
          </div>
          <div className="landing-meta-item">
            <Check size={14} />
            <span>{t('heroMeta3')}</span>
          </div>
        </motion.div>

        <motion.div
          className="hero-proof-row"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.8, ease: 'easeOut' }}
        >
          <div>
            <strong>{t('heroProofRules')}</strong>
            <span>{t('heroProofRulesSub')}</span>
          </div>
          <div>
            <strong>{t('heroProofEngine')}</strong>
            <span>{t('heroProofEngineSub')}</span>
          </div>
          <div>
            <strong>{t('heroProofReview')}</strong>
            <span>{t('heroProofReviewSub')}</span>
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
            <span>{t('heroPreviewReady')}</span>
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
  const { t, isRtl, language } = useI18n()
  const time = (range) => formatMockTime(range, language)
  const days = [
    {
      day: t('mockDayMon'),
      shifts: [
        { name: t('mockNameMaya'), role: t('roleShiftSupervisor'), time: time('4a - 11a'), color: 'pink' },
        { name: t('mockNameEli'), role: t('roleBarista'), time: time('4a - 12p'), color: 'red' },
        { name: t('mockNameOwen'), role: t('roleShiftSupervisor'), time: time('12:30p - 8:30p'), color: 'purple' },
      ],
    },
    {
      day: t('mockDayTue'),
      shifts: [
        { name: t('mockNameMaya'), role: t('roleShiftSupervisor'), time: time('4a - 11a'), color: 'pink' },
        { name: t('mockNameNoah'), role: t('roleBarista'), time: time('5a - 11:30a'), color: 'blue' },
        { name: t('mockNameRiley'), role: t('roleBarista'), time: time('12:30p - 8p'), color: 'red' },
      ],
    },
    {
      day: t('mockDayWed'),
      shifts: [
        { name: t('mockNameOwen'), role: t('roleShiftSupervisor'), time: time('4a - 12p'), color: 'purple' },
        { name: t('mockNameSofia'), role: t('roleBarista'), time: time('4a - 11a'), color: 'pink' },
        { name: t('mockNameTheo'), role: t('roleShiftSupervisor'), time: time('12p - 8p'), color: 'pink' },
      ],
    },
    {
      day: t('mockDaySun'),
      shifts: [
        { name: t('mockNameLena'), role: t('roleShiftSupervisor'), time: time('4a - 12p'), color: 'purple' },
        { name: t('mockNameLeo'), role: t('roleManager'), time: time('10a - 4p'), color: 'green' },
        { name: t('mockOpenShift'), role: t('roleBarista'), time: time('12p - 3p'), color: 'empty' },
      ],
    },
  ]

  return (
    <div className="mockup-window mockup-v2 product-proof" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mockup-header">
        <div className="mockup-dots">
          <span></span><span></span><span></span>
        </div>
        <div className="mockup-url">hengam.app/schedule</div>
      </div>
      <div className="mockup-body">
        <div className="proof-layout">
          <aside className="proof-rules">
            <div className="proof-label">{t('mockManagerRules')}</div>
            <div className="proof-rule">
              <Clock size={13} />
              <span>{t('mockRuleCoverage')}</span>
            </div>
            <div className="proof-rule">
              <Users size={13} />
              <span>{t('mockRuleTargets')}</span>
            </div>
            <div className="proof-rule">
              <Shield size={13} />
              <span>{t('mockRuleRest')}</span>
            </div>
            <div className="proof-rule proof-warning">
              <AlertTriangle size={13} />
              <span>{t('mockRuleAvailability')}</span>
            </div>
          </aside>

          <div className="proof-schedule-wrap">
            <div className="mockup-title-row">
              <div>
                <div className="mockup-title">{t('mockWeekTitle')}</div>
                <div className="proof-subtitle">{t('mockWeekSubtitle')}</div>
              </div>
              <div className="mockup-badge">
                <Sparkles size={12} />
                <span>{t('mockReadyReview')}</span>
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
                <span>{t('mockHoursSummary')}</span>
              </div>
              <div className="proof-issue">
                <AlertTriangle size={14} />
                <span>{t('mockIssue')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatMockTime(range, language) {
  if (language !== 'fa') return range
  return range.split(' - ').map(part => {
    const match = part.match(/^(\d{1,2})(?::(\d{2}))?([ap])$/)
    if (!match) return part
    const rawHour = Number(match[1])
    const hour = match[3] === 'p' && rawHour !== 12 ? rawHour + 12 : match[3] === 'a' && rawHour === 12 ? 0 : rawHour
    const minute = match[2] || '00'
    return `${String(hour).padStart(2, '0')}:${minute}`.replace(/\d/g, d => Number(d).toLocaleString('fa-IR'))
  }).join(' - ')
}

// ========== MARQUEE STRIP ==========
function MarqueeStrip() {
  const { t } = useI18n()
  const items = [
    'marqueeRestaurants', 'marqueeCoffee', 'marqueeRetail', 'marqueeSalons', 'marqueeGyms', 'marqueeBars',
    'marqueeBakeries', 'marqueeBoutiques', 'marqueeStudios', 'marqueeClinics', 'marqueeAuto', 'marqueeCare'
  ]
  return (
    <section className="marquee-section">
      <p className="marquee-label">{t('marqueeLabel')}</p>
      <div className="marquee">
        <div className="marquee-track">
          {items.map((item) => (
            <span key={item} className="marquee-item">
              <span className="marquee-dot" />
              {t(item)}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function PremiumPanels() {
  const { t, isRtl } = useI18n()
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
    { time: '4 AM', title: t('premiumOpeningShift'), status: 'ready', avatars: [t('premiumAvatar1'), t('premiumAvatar2')] },
    { time: '8 AM', title: t('premiumMorningRush'), status: 'active', avatars: [t('premiumAvatar3'), t('premiumAvatar4'), t('premiumAvatar5')] },
    { time: '12 PM', title: t('premiumCoverageCheck'), status: 'ready', avatars: [t('premiumAvatar6'), t('premiumAvatar7')] },
    { time: '3 PM', title: t('premiumCoverageGap'), status: 'gap', avatars: ['+'] },
  ]

  const ruleRows = [
    { label: t('premiumPairing'), value: t('premiumPairingValue') },
    { label: t('premiumRest'), value: t('premiumRestValue') },
    { label: t('premiumHours'), value: t('premiumHoursValue') },
    { label: t('premiumReview'), value: t('premiumReviewValue') },
  ]

  const coverageStats = [
    { value: '4', label: t('premiumStatWindows') },
    { value: '13', label: t('premiumStatTargets') },
    { value: '1', label: t('premiumStatGap') },
  ]

  const issueAdvice = [
    t('premiumAdvice1'),
    t('premiumAdvice2'),
    t('premiumAdvice3'),
  ]

  return (
    <section className="landing-section premium-panels-section">
      <SectionHeader
        eyebrow={t('premiumEyebrow')}
        title={t('premiumTitle')}
        description={t('premiumDescription')}
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
            <h3>{t('premiumCoverageTitle')}</h3>
            <p>{t('premiumCoverageCopy')}</p>
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
            <span>{t('premiumHealthOpening')}</span>
            <span>{t('premiumHealthTargets')}</span>
            <span>{t('premiumHealthReview')}</span>
          </div>
          <div className="premium-calendar-scene" aria-hidden="true">
            <div className="premium-calendar-card">
              <div className="premium-calendar-head">
                <span>{t('mockMonthMay')}</span>
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
                      <small>{event.status === 'gap' ? t('premiumNeedsOne') : t('premiumRoleChecked')}</small>
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
            <h3>{t('premiumRulesTitle')}</h3>
            <p>{t('premiumRulesCopy')}</p>
          </div>
          <div className="premium-rule-input-demo" aria-hidden="true" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="premium-rule-input-box">
              <span>{t('premiumManagerNote')}</span>
              <p>{t('premiumManagerNoteCopy')}</p>
            </div>
            <div className="premium-parser-line">
              <Sparkles size={14} />
              <span>{t('premiumParsing')}</span>
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
              <span>{t('premiumReady')}</span>
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
            <h3>{t('premiumIssueTitle')}</h3>
            <p>{t('premiumIssueCopy')}</p>
          </div>
          <div className="premium-demo-group">
            <div className="premium-note-card" aria-hidden="true">
              <AlertTriangle size={15} />
              <span>{t('premiumIssueNote')}</span>
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
            <h3>{t('premiumHistoryTitle')}</h3>
            <p>{t('premiumHistoryCopy')}</p>
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
  const { t } = useI18n()
  const steps = [
    {
      icon: Users,
      number: '01',
      title: t('step1Title'),
      description: t('step1Desc'),
    },
    {
      icon: Calendar,
      number: '02',
      title: t('step2Title'),
      description: t('step2Desc'),
    },
    {
      icon: Sparkles,
      number: '03',
      title: t('step3Title'),
      description: t('step3Desc'),
    },
  ]

  return (
    <section id="how-it-works" className="landing-section steps-section">
      <SectionHeader 
        eyebrow={t('stepsEyebrow')}
        title={t('stepsTitle')}
        description={t('stepsDescription')}
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
  const { t } = useI18n()
  const checks = [
    {
      label: t('trustHardRules'),
      items: [t('trustCorrectRoles'), t('trustAvailability'), t('trustTimeOff'), t('trustOneShift')],
    },
    {
      label: t('trustCoverage'),
      items: [t('trustOpeners'), t('trustClosers'), t('trustMinimumStaffing'), t('trustPreClosing')],
    },
    {
      label: t('trustFairness'),
      items: [t('trustTargetHours'), t('trustFewerShort'), t('trustWarnings'), t('trustExplainable')],
    },
  ]

  return (
    <section className="landing-section trust-section">
      <div className="trust-panel">
        <div className="trust-copy">
          <div className="landing-section-eyebrow">{t('trustEyebrow')}</div>
          <h2 className="landing-section-title">{t('trustTitle')}</h2>
          <p className="landing-section-desc">
            {t('trustDescription')}
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
  const { t } = useI18n()

  const questions = [
    {
      question: t('qaQ1'),
      answer: t('qaA1'),
    },
    {
      question: t('qaQ2'),
      answer: t('qaA2'),
    },
    {
      question: t('qaQ3'),
      answer: t('qaA3'),
    },
    {
      question: t('qaQ4'),
      answer: t('qaA4'),
    },
    {
      question: t('qaQ5'),
      answer: t('qaA5'),
    },
  ]

  return (
    <section className="landing-section playground-section">
      <SectionHeader 
        eyebrow={t('qaEyebrow')}
        title={t('qaTitle')}
        description={t('qaDescription')}
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
          <div className="qa-aside-orbit" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="qa-aside-icon">
            <MessageSquare size={18} />
          </div>
          <div className="qa-aside-copy">
            <strong>{t('qaAsideTitle')}</strong>
            <span>{t('qaAsideCopy')}</span>
          </div>
          <div className="qa-aside-steps">
            <span><Check size={13} /> {t('qaAsideStep1')}</span>
            <span><Shield size={13} /> {t('qaAsideStep2')}</span>
            <span><ArrowUpRight size={13} /> {t('qaAsideStep3')}</span>
          </div>
        </div>
      </motion.div>
    </section>
  )
}

// ========== FEATURES ==========
function Features() {
  const { t } = useI18n()
  const features = [
    { icon: Brain, title: t('featureRulesTitle'), description: t('featureRulesDesc') },
    { icon: Clock, title: t('featureWindowsTitle'), description: t('featureWindowsDesc') },
    { icon: Shield, title: t('featureChecksTitle'), description: t('featureChecksDesc') },
    { icon: AlertTriangle, title: t('featureImpossibleTitle'), description: t('featureImpossibleDesc') },
    { icon: TrendingUp, title: t('featureTargetsTitle'), description: t('featureTargetsDesc') },
    { icon: Zap, title: t('featureDraftsTitle'), description: t('featureDraftsDesc') },
  ]

  return (
    <section className="landing-section">
      <SectionHeader 
        eyebrow={t('featuresEyebrow')}
        title={t('featuresTitle')}
        description={t('featuresDescription')}
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
  const { t } = useI18n()
  const tiers = [
    {
      id: 'free',
      name: t('tierFree'),
      price: '$0',
      period: t('priceForever'),
      description: t('priceFreeDesc'),
      features: [t('priceUpTo5'), t('priceOneSchedule'), t('priceBasic'), t('priceEmailSupport')],
      cta: t('priceFreeCta'),
      highlighted: false,
    },
    {
      id: 'pro',
      name: t('tierPro'),
      price: '$9',
      period: t('priceMonthly'),
      description: t('priceProDesc'),
      features: [t('priceUpTo25'), t('priceUnlimitedSchedules'), t('priceCustomRules'), t('priceHistory'), t('pricePriority')],
      cta: t('priceProCta'),
      highlighted: true,
    },
    {
      id: 'business',
      name: t('tierBusiness'),
      price: '$19',
      period: t('priceMonthly'),
      description: t('priceBusinessDesc'),
      features: [t('priceUnlimitedEmployees'), t('priceUnlimitedEverything'), t('priceAdvanced'), t('priceLocations'), t('priceDedicated')],
      cta: t('priceBusinessCta'),
      highlighted: false,
    },
  ]

  return (
    <section className="landing-section">
      <SectionHeader 
        eyebrow={t('pricingEyebrow')}
        title={t('pricingTitle')}
        description={t('pricingDescription')}
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
            {tier.highlighted && <div className="landing-pricing-badge">{t('pricePopular')}</div>}
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
                if (tier.id === 'business') {
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
  const { t } = useI18n()
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
        <h2 className="landing-final-title">{t('finalTitle')}</h2>
        <p className="landing-final-subtitle">
          {t('finalSubtitle')}
        </p>
        <button className="landing-cta-primary landing-cta-large cta-glow" onClick={onCTA}>
          <span>{t('heroCtaOut')}</span>
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
