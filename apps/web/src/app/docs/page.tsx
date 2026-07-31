import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { REGISTER } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'Documentation — Nexora OS',
  description: 'Developer documentation and API overview for Nexora.',
};

export default function DocsPage() {
  return (
    <MarketingShell title="Documentation" subtitle="APIs, connectors, and operator guides.">
      <div className="grid gap-4 md:grid-cols-2">
        {[
          ['Getting started', 'Create an account, connect Slack or Notion, run your first command.'],
          ['API overview', 'Authenticated REST endpoints for chat, approvals, integrations, and admin.'],
          ['Connectors', 'Live Slack and Notion execution; mock connectors for demo fidelity.'],
          ['Security', 'JWT sessions, encrypted tokens, RBAC, and approval gates.'],
        ].map(([t, b]) => (
          <div key={t} className="rounded-[22px] border border-white/8 bg-white/[0.03] p-5">
            <h2 className="font-display text-lg text-white">{t}</h2>
            <p className="mt-2 text-sm text-neutral-400">{b}</p>
          </div>
        ))}
      </div>
      <Link href={REGISTER} className="mt-8 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]">
        Start Free
      </Link>
    </MarketingShell>
  );
}
