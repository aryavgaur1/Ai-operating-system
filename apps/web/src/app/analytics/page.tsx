import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { AnalysisDashboard } from '@/components/landing/AnalysisDashboard';
import { REGISTER } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'Nexora OS — Analytics',
  description: 'Operator-grade visibility into approvals, action outcomes, and workspace activity in Nexora OS.',
};

export default function AnalyticsPage() {
  return (
    <MarketingShell
      title="Analytics"
      subtitle="Visibility into what Nexora actually did — approvals, verified outcomes, and workspace activity."
    >
      <AnalysisDashboard />
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          ['Action timeline', 'Every propose → approve → act step is recorded for audit and replay.'],
          ['Approval queue', 'See pending, approved, and failed actions with real error context.'],
          ['Workspace pulse', 'Track connector health and recent execution outcomes.'],
        ].map(([title, copy]) => (
          <div key={title} className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
            <div className="font-display text-lg text-white">{title}</div>
            <p className="mt-2 text-sm leading-7 text-neutral-400">{copy}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 text-sm text-neutral-500">
        Signed-in teams see live analytics in the workspace dashboard and approvals timeline — connected to real
        execution data, not mock charts.
      </p>
      <Link href={REGISTER} className="mt-6 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]">
        Start Free
      </Link>
    </MarketingShell>
  );
}
