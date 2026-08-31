import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { IntegrationAccordion } from '@/components/landing/IntegrationAccordion';
import { LOGIN, REGISTER } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'Nexora OS — Integrations',
  description: 'Connect Slack, Notion, Gmail, Jira, Zoom, Asana, Microsoft 365, Discord, and Salesforce.',
};

export default function MarketingIntegrationsPage() {
  return (
    <MarketingShell
      title="Integrations"
      subtitle="Hover a tool to expand it. Slack, Notion, Jira, and Gmail run live today — the rest are ready for your workspace."
    >
      <IntegrationAccordion />
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={REGISTER} className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]">
          Start Free
        </Link>
        <Link href={LOGIN} className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-white">
          Open workspace
        </Link>
      </div>
    </MarketingShell>
  );
}
