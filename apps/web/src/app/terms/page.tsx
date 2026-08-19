import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'Terms — Nexora OS',
  description: 'Nexora OS terms of service.',
};

export default function TermsPage() {
  return (
    <MarketingShell title="Terms of Service" subtitle="Terms governing access to and use of Nexora OS.">
      <div className="max-w-3xl space-y-6 text-sm leading-7 text-neutral-300">
        <p>
          <strong className="text-white">Effective date:</strong> August 19, 2026
        </p>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Nexora OS (&quot;Nexora&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you agree to be bound by these Terms
            of Service and applicable laws.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">2. Eligibility and Account Responsibility</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>You are responsible for the accuracy of account information you provide.</li>
            <li>You are responsible for safeguarding your credentials and API access.</li>
            <li>You are responsible for all actions taken under your account and workspace.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">3. Service Description</h2>
          <p>
            Nexora provides AI-assisted workspace operations, collaboration workflows, and authorized integrations
            with third-party services. Features may evolve, and some capabilities may be region- or plan-dependent.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">4. Acceptable Use</h2>
          <p>You agree not to use the service to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Violate law, regulations, or third-party rights.</li>
            <li>Attempt unauthorized access, abuse, or service disruption.</li>
            <li>Transmit malicious code, phishing content, or fraudulent communications.</li>
            <li>Bypass security controls or role-based authorization boundaries.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">5. Integrations and Third-Party Services</h2>
          <p>
            Integrations (including Gmail, Slack, Jira, and Notion) are optional and user-authorized. Your use of
            third-party services is governed by their own terms and privacy policies. Nexora is not responsible for
            third-party service availability, content, or policy changes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">6. Data and Privacy</h2>
          <p>
            Our handling of personal data is described in the Privacy Policy. By using Nexora, you acknowledge and
            agree to those data practices.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">7. Intellectual Property</h2>
          <p>
            Nexora and related branding, software, and service materials are protected by intellectual property laws.
            Except as expressly permitted, no rights are granted to copy, modify, distribute, or reverse engineer the
            service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">8. Service Availability and Changes</h2>
          <p>
            We may modify, suspend, or discontinue features to improve reliability, security, or compliance. We aim
            to provide reasonable notice for material changes when practical.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">9. Disclaimer</h2>
          <p>
            The service is provided on an &quot;as is&quot; and &quot;as available&quot; basis, without warranties of any kind, to the
            extent permitted by law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">10. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Nexora is not liable for indirect, incidental, special,
            consequential, or punitive damages arising from use of the service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">11. Termination</h2>
          <p>
            We may suspend or terminate access for violation of these Terms, security risk, legal requirement, or
            abuse. You may discontinue use at any time.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">12. Changes to Terms</h2>
          <p>
            We may update these Terms periodically. Continued use after updated terms are posted constitutes
            acceptance of those changes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">13. Contact</h2>
          <p>
            For legal or compliance inquiries, contact{' '}
            <a className="text-accent underline" href="mailto:aryavgaur01@gmail.com">
              aryavgaur01@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </MarketingShell>
  );
}
