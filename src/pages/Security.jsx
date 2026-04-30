import { Lock, Server, ShieldCheck, Mail } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

function Security() {
  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow="Trust & Safety"
        title="Security"
        subtitle="How we protect your data and your team's information."
      />

      <Section title="Authentication" icon={Lock} delay={0.05}>
        <div className="legal-text">
          <p>
            All user identity is handled by Firebase Authentication — we never store raw passwords.
            Passwords are hashed using industry-standard bcrypt via Firebase's managed auth system.
            All sessions are validated server-side on every authenticated request.
          </p>
        </div>
      </Section>

      <Section title="Data protection" icon={Server} delay={0.1}>
        <div className="legal-text">
          <ul>
            <li>
              <strong>Encryption in transit</strong> — all communication between your browser and
              our servers uses TLS 1.2+.
            </li>
            <li>
              <strong>Encryption at rest</strong> — Firestore and Firebase Storage encrypt all data
              at rest by default.
            </li>
            <li>
              <strong>Access rules</strong> — Firestore security rules enforce that users can only
              read and write their own workspace data. Employee accounts are restricted to read-only
              access of their own shifts.
            </li>
          </ul>
          <p>
            Schedule generation uses Hengam's scheduling engine. We send only the minimum necessary data
            (employee names, roles, availability) — never contact information or credentials.
          </p>
        </div>
      </Section>

      <Section title="Responsible disclosure" icon={ShieldCheck} delay={0.15}>
        <div className="legal-text">
          <p>
            If you discover a security vulnerability in Hengam, please report it responsibly.
            Email us at{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a> with a
            description of the issue and steps to reproduce it.
          </p>
          <p>
            Please do not publicly disclose vulnerabilities until we've had a reasonable opportunity
            to address them. We'll acknowledge your report within 72 hours.
          </p>
        </div>
      </Section>
    </main>
  )
}

export default Security
