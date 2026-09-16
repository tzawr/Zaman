import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import ScrollClock from '../components/ScrollClock'
import { useAuth } from '../AuthContext'
import { useI18n } from '../i18n'
import './LandingCinematic.css'

/**
 * Cinematic landing: two editorial sections over a scroll-driven clock.
 * Copy is English-only for now; the layout uses logical properties so the
 * Persian direction flips correctly once the strings are wired into i18n.
 */
export default function LandingCinematic() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { isRtl } = useI18n()

  function handleCTA() {
    navigate(currentUser ? '/dashboard' : '/signup')
  }

  return (
    <div className="cine" dir={isRtl ? 'rtl' : 'ltr'}>
      <ScrollClock startHour={9} sweepMinutes={120} />
      <div className="cine-content">
        <main>
          <SectionOne onCTA={handleCTA} />
          <div className="cine-spacer" aria-hidden="true" />
          <SectionTwo onCTA={handleCTA} />
        </main>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function useReveal() {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, shown]
}

function Reveal({ delay = 0, className = '', as = 'div', children }) {
  const Tag = as
  const [ref, shown] = useReveal()
  return (
    <Tag
      ref={ref}
      className={`cine-reveal ${shown ? 'is-shown' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  )
}

/* ------------------------------------------------------------------ */

const SERVICES = ['Coverage rules in plain English', 'Checked weekly rota', 'Explained gaps']

function SectionOne({ onCTA }) {
  return (
    <section className="cine-section">
      <div className="cine-row cine-row--top">
        <ul className="cine-services">
          {SERVICES.map((s, i) => (
            <Reveal as="li" key={s} delay={150 + i * 120} className="cine-mono">
              / {s}
            </Reveal>
          ))}
        </ul>
        <Reveal delay={300} className="cine-intro">
          Hengam turns the way you already describe your week into a schedule that is checked before anyone sees it.
        </Reveal>
      </div>

      <div className="cine-row cine-row--bottom">
        <div>
          <Reveal delay={150} className="cine-badge">
            Two hours a week, every week
          </Reveal>
          <Reveal as="h1" delay={280} className="cine-headline">
            Sunday night.
            <br />
            Back.
          </Reveal>
        </div>

        <Reveal delay={420} className="cine-card">
          <div className="cine-card-clock" aria-hidden="true">
            <span className="cine-card-clock-hand cine-card-clock-hand--hour" />
            <span className="cine-card-clock-hand cine-card-clock-hand--minute" />
          </div>
          <div className="cine-card-text">
            <div className="cine-card-title">Try it with your team</div>
            <div className="cine-mono cine-mono--dim">Free for up to 5 people</div>
            <button type="button" className="cine-btn cine-btn--primary cine-card-btn" onClick={onCTA}>
              Build this week <ChevronRight size={14} />
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

const CAPABILITIES = [
  {
    n: '01',
    title: 'Plain-English rules',
    body: '"1 supervisor and 1 barista from open until 4pm, nobody closes then opens." That is the whole input.',
  },
  {
    n: '02',
    title: 'Deterministic output',
    body: 'Same team, same rules, same week: the same rota. Reload and nothing shifts under you.',
  },
  {
    n: '03',
    title: 'Honest gaps',
    body: 'When a week cannot be staffed it says which shift is uncovered and which rule made it so.',
  },
]

function SectionTwo({ onCTA }) {
  return (
    <section className="cine-section">
      <div className="cine-row cine-row--top">
        <Reveal delay={120} className="cine-badge">
          Knows when it can't
        </Reveal>
        <Reveal delay={220} className="cine-intro cine-intro--wide">
          The model reads your rules. Code builds the week. Nothing that looks fine and isn't.
        </Reveal>
      </div>

      <div className="cine-row cine-row--bottom cine-row--capability">
        <div className="cine-copy">
          <Reveal as="h2" delay={180} className="cine-headline">
            See the whole
            <br />
            week.
          </Reveal>
          <Reveal as="p" delay={320} className="cine-body">
            From availability and time off to role coverage and rest gaps, Hengam holds every constraint at once and
            tells you the moment they stop fitting together.
          </Reveal>
          <Reveal delay={420} className="cine-ctas">
            <button type="button" className="cine-btn cine-btn--primary" onClick={onCTA}>
              Build this week <ChevronRight size={14} />
            </button>
            <a className="cine-btn cine-btn--ghost" href="/pricing">
              See pricing
            </a>
          </Reveal>
        </div>

        <div className="cine-panel">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.n} delay={300 + i * 110} className="cine-panel-row">
              <span className="cine-mono cine-panel-index">{c.n}</span>
              <div className="cine-panel-text">
                <div className="cine-panel-title">
                  {c.title}
                  <ChevronRight size={16} className="cine-panel-chevron" />
                </div>
                <p className="cine-panel-body">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
