import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'Privacy — Nexora OS',
  description: 'Nexora OS privacy policy.',
};

export default function PrivacyPage() {
  return (
    <MarketingShell title="Privacy Policy" subtitle="How Nexora OS collects, uses, and protects your data.">
      <div className="max-w-3xl space-y-6 text-sm leading-7 text-neutral-300">
        <p>
          <strong className="text-white">Effective date:</strong> August 19, 2026
        </p>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">1. Scope</h2>
          <p>
            This Privacy Policy explains how Nexora OS (&quot;Nexora&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) handles
            personal data when you access or use our web application, APIs, and related services.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">2. Data We Collect</h2>
          <p>Depending on your use of the service, we may collect and process:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Account data (name, email address, authentication identifiers).</li>
            <li>Workspace data (workspace names, member roles, invitations, and settings).</li>
            <li>Usage data (logs, timestamps, feature interaction, and diagnostics).</li>
            <li>Integration metadata (connected provider, scopes, status, and account identifiers).</li>
            <li>Security data required to prevent abuse, fraud, and unauthorized access.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">3. How We Use Data</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>To provide, operate, and maintain the Nexora platform.</li>
            <li>To authenticate users and enforce role-based access control.</li>
            <li>To enable integrations you explicitly connect (such as Gmail, Slack, Jira, and Notion).</li>
            <li>To improve reliability, security, and product performance.</li>
            <li>To communicate service, legal, or security notices.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">4. Integrations and OAuth Data</h2>
          <p>
            When you connect third-party services, Nexora processes OAuth credentials and integration metadata to
            enable requested functionality. Tokens are encrypted at rest and scoped to the authenticated user and
            workspace authorization context. We do not expose refresh tokens or client secrets in client-side code.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">5. Security Controls</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>Encryption at rest for sensitive token material.</li>
            <li>Encrypted transport using HTTPS/TLS in transit.</li>
            <li>Server-side authorization checks for workspace and connector actions.</li>
            <li>Operational logging and monitoring for security and incident response.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">6. Data Sharing</h2>
          <p>
            We do not sell personal data. We share data only as necessary to provide the service, comply with law,
            protect rights, or process requests through connected providers you authorize.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">7. Data Retention</h2>
          <p>
            We retain data for as long as necessary to provide services, meet legal obligations, resolve disputes,
            and enforce agreements. You may request deletion of your account data, subject to applicable legal and
            operational retention requirements.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">8. Your Rights</h2>
          <p>
            Subject to local law, you may request access, correction, deletion, or export of your personal data. You
            may also disconnect integrations at any time through Nexora settings.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">9. International Processing</h2>
          <p>
            Nexora may process data in regions where our infrastructure or service providers operate. We apply
            reasonable safeguards appropriate to the nature of the data processed.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">10. Policy Updates</h2>
          <p>
            We may update this Privacy Policy periodically. Material updates will be reflected by an updated effective
            date and, where required, additional notice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-white">11. Contact</h2>
          <p>
            For privacy inquiries or data requests, contact us at{' '}
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
