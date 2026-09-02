import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { REGISTER } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'Nexora OS — How It Works',
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
        <h2 className="font-display text-2xl font-semibold text-white">The Nexora action loop</h2>
        <ol className="mt-6 space-y-4">
          {[
            ['User intent', 'You ask in natural language — typed in chat.'],
            ['Understand', 'Nexora classifies read vs action and picks the connector family.'],
            ['Plan', 'Tool calls are prepared with inputs, risk, and impact preview.'],
            ['Show what will happen', 'Approval cards show intent, target, and blast radius.'],
            ['Approval', 'High-consequence writes pause until you Approve & run.'],
            ['Execute', 'Live OAuth credentials call Slack, Jira, Notion, or Gmail.'],
            ['Verify', 'The external API response is checked — no fake success.'],
            ['Result', 'Verified outcomes with real resource links when available.'],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-4 text-sm">
              <span className="font-display mt-0.5 w-6 shrink-0 text-accent2">{i + 1}</span>
              <div>
                <strong className="text-white">{title}</strong>
                <p className="mt-1 leading-7 text-neutral-400">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link href={REGISTER} className="mt-8 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]">
          Start Free
        </Link>
      </div>
    </MarketingShell>
  );
}
