import { Zap, Target, Mail } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

function About() {
  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow="Company"
        title="About Zaman"
        subtitle="Zaman is the Persian word for time. That's what we're giving back to managers."
      />

      <Section title="What we're building" icon={Zap} delay={0.05}>
        <div className="legal-text">
          <p>
            Zaman is an AI-powered scheduling tool for shift managers who spend too much of their
            week staring at a spreadsheet, texting employees about availability, and rebuilding the
            same schedule from scratch every week.
          </p>
          <p>
            Most scheduling software is either too simple (a shared Google Sheet) or too complex
            (an enterprise HR platform that takes months to set up). Neither is built for the real
            experience of a shift manager at a restaurant, retail store, or small business.
          </p>
        </div>
      </Section>

      <Section title="How it works" icon={Target} delay={0.1}>
        <div className="legal-text">
          <p>
            Managers add their team, set each employee's availability and roles, then describe what
            they need for the week. Zaman's AI generates a complete draft schedule in seconds.
          </p>
          <p>
            From there, managers can edit, export as CSV or PDF, and share with their team.
            Employees log in to see only their own shifts — nothing else.
          </p>
          <p>
            The AI handles the hard part — balancing availability, minimum coverage, role
            requirements, and anti-clopening rules — so managers spend minutes on a schedule,
            not hours.
          </p>
        </div>
      </Section>

      <Section title="Get in touch" icon={Mail} delay={0.15}>
        <div className="legal-text">
          <p>
            Built in Irvine, CA. We'd love to hear from you — feedback, feature requests, or
            just a hello. Email us at{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>.
          </p>
        </div>
      </Section>
    </main>
  )
}

export default About
