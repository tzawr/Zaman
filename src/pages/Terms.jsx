import { FileText, Users, AlertTriangle, Scale } from 'lucide-react'
import PageHero from '../components/PageHero'
import Section from '../components/Section'

function Terms() {
  return (
    <main className="app-page app-page-narrow">
      <PageHero
        eyebrow="Legal"
        title="Terms of Service"
        subtitle="Last updated April 25, 2025. By using Zaman you agree to these terms."
      />

      <Section title="Using Zaman" icon={FileText} delay={0.05}>
        <div className="legal-text">
          <p>
            By creating an account you agree to these Terms. If you don't agree, don't use the
            service.
          </p>
          <p>Zaman is an employee scheduling tool for shift managers and their teams.</p>
          <ul>
            <li>You must be 18 or older to create a manager account.</li>
            <li>You're responsible for keeping your credentials secure.</li>
            <li>You're responsible for all activity that happens under your account.</li>
            <li>Don't share your account with others or create accounts on behalf of others without
              their knowledge.</li>
          </ul>
        </div>
      </Section>

      <Section title="Acceptable use" icon={AlertTriangle} delay={0.1}>
        <div className="legal-text">
          <p>You agree not to:</p>
          <ul>
            <li>Use Zaman for any unlawful purpose.</li>
            <li>Upload content that is harmful, offensive, or infringes on others' rights.</li>
            <li>Attempt to gain unauthorized access to other accounts or our systems.</li>
            <li>Reverse engineer, decompile, or extract the source code of Zaman.</li>
            <li>Use automated scripts to access the service without our written permission.</li>
          </ul>
        </div>
      </Section>

      <Section title="Employees & schedules" icon={Users} delay={0.15}>
        <div className="legal-text">
          <p>
            Manager accounts may invite employees. Employee accounts are free and provide read-only
            access to that person's own schedule. Managers are responsible for ensuring invitations
            are sent only to individuals who've agreed to participate.
          </p>
          <p>
            Zaman-generated schedules are a starting point — you remain solely responsible for
            reviewing, approving, and communicating final schedules to your team. Zaman makes no
            guarantee that generated schedules comply with labor laws, union agreements, or other
            regulatory requirements.
          </p>
        </div>
      </Section>

      <Section title="Liability & changes" icon={Scale} delay={0.2}>
        <div className="legal-text">
          <p>
            Zaman is provided "as is" without warranties of any kind. We don't warrant the service
            will be uninterrupted or error-free.
          </p>
          <p>
            To the maximum extent permitted by law, Zaman and its founders shall not be liable for
            any indirect, incidental, special, or consequential damages arising from your use of the
            service.
          </p>
          <p>
            We may suspend or terminate your account at any time if you violate these Terms. You
            may delete your account at any time from the Settings page.
          </p>
          <p>
            We may update these Terms from time to time. Material changes will be communicated by
            email. Questions? Email{' '}
            <a href="mailto:aliseyfiazadsa6@gmail.com">aliseyfiazadsa6@gmail.com</a>.
          </p>
        </div>
      </Section>
    </main>
  )
}

export default Terms
