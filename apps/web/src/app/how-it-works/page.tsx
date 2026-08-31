import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { REGISTER } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'How It Works — Nexora OS',
  description: 'Propose → Approve → Act across Slack, Jira, Notion, and Gmail with human gates and verified execution.',
};

export default function HowItWorksPage() {
  return (
    <MarketingShell
      title="How It Works"
      subtitle="Nexora is an Action OS — not a chatbot. Every consequential write is planned, gated, executed, and verified."
    >
      <HowItWorksSection />
      <div className="mt-16 rounded-[28px] border border-white/10 bg-white/[0.03] p-6 sm:p-8">
        <h2 className="font-display text-2xl font-semibold text-white">The action loop</h2>
        <ol className="mt-5 space-y-4 text-sm leading-7 text-neutral-400">
          <li>
            <strong className="text-white">Intent</strong> — You ask in natural language. Nexora classifies read vs
            action and routes to the right connector.
          </li>
          <li>
            <strong className="text-white">Plan</strong> — Tool calls are prepared with inputs, risk level, and impact
            preview.
          </li>
          <li>
            <strong className="text-white">Approve</strong> — High-consequence actions pause until you Approve & run.
          </li>
          <li>
            <strong className="text-white">Execute</strong> — Live OAuth credentials call Slack, Jira, Notion, or Gmail.
          </li>
          <li>
            <strong className="text-white">Verify</strong> — Results are checked against the external API. Real URLs are
            returned when available.
          </li>
        </ol>
        <Link href={REGISTER} className="mt-8 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]">
          Start Free
        </Link>
      </div>
    </MarketingShell>
  );
}
