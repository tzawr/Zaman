import { Shield, Database, User, Mail } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

function Privacy() {
  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow="Legal"
        title="Privacy Policy"
        subtitle="Last updated April 25, 2025. We keep this short and plain."
      />

      <Section title="What we collect" icon={Database} delay={0.05}>
        <div className="legal-text">
          <p>We collect only what's needed to run the service:</p>
          <ul>
            <li><strong>Account info</strong> — your name, email address, and hashed password.</li>
            <li><strong>Workspace data</strong> — employee names, roles, availability, and schedules you create inside Zaman.</li>
            <li><strong>Usage data</strong> — pages visited and features used, to improve the product.</li>
          </ul>
          <p>
            We do not sell your data to anyone. We do not use your scheduling data to train AI
            models without your explicit consent.
          </p>
        </div>
      </Section>

      <Section title="How we use it" icon={Shield} delay={0.1}>
        <div className="legal-text">
          <p>Your information is used to:</p>
          <ul>
            <li>Provide, maintain, and improve Zaman.</li>
            <li>Send transactional emails — account confirmations, schedule exports, team invites.</li>
            <li>Respond to support requests.</li>
            <li>Detect and prevent fraud or abuse.</li>
          </ul>
          <p>
            Schedule generation uses the OpenAI API. We send only employee names, roles, and
            availability — no contact information or passwords — to generate a schedule.
          </p>
        </div>
      </Section>

      <Section title="Storage, security & retention" icon={Database} delay={0.15}>
        <div className="legal-text">
          <p>
            Your data lives on Firebase (Google Cloud) infrastructure with encryption at rest and
            in transit. We apply industry-standard access controls and Firestore security rules
            so each user can only access their own data.
          </p>
          <p>
            We retain your data for as long as your account is active. If you delete your account,
            your personal information is removed within 30 days, except where we're legally required
            to keep it.
          </p>
          <p>
            We use cookies only for essential authentication (keeping you logged in) and preference
            storage (light/dark mode). No advertising or third-party tracking cookies.
          </p>
        </div>
      </Section>

      <Section title="Your rights & contact" icon={User} delay={0.2}>
        <div className="legal-text">
          <p>
            Depending on your location, you may have the right to access, correct, or delete your
            personal data. To exercise any of these rights — or if you have any questions about
            this policy — email us at{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>.
          </p>
          <p>
            We may update this policy from time to time. Significant changes will be communicated
            by email or via an in-app notice.
          </p>
        </div>
      </Section>
    </main>
  )
}

export default Privacy
