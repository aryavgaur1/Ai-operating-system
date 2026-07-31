import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'Enterprise — Nexora OS',
  description: 'Security, RBAC, audit logs, and workspace isolation for enterprise teams.',
};

const ITEMS = [
  ['Encryption', 'Tokens encrypted at rest; TLS in transit.'],
  ['OAuth', 'Per-user connections when multi-tenant SaaS is enabled.'],
  ['Audit Logs', 'Every sensitive action is attributable.'],
  ['RBAC', 'Owner, admin, member, viewer controls.'],
  ['Workspace Isolation', 'Org-scoped data boundaries.'],
  ['Approvals', 'Human gates for high-impact tool execution.'],
];

export default function EnterprisePage() {
  return (
    <MarketingShell
      title="Enterprise"
      subtitle="Built for trust under pressure — security and control without slowing execution."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map(([t, b]) => (
          <div key={t} className="rounded-[22px] border border-white/8 bg-white/[0.03] p-5">
            <h2 className="font-display text-lg text-white">{t}</h2>
            <p className="mt-2 text-sm text-neutral-400">{b}</p>
          </div>
        ))}
      </div>
    </MarketingShell>
  );
}
