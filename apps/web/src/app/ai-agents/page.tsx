import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { AgentLivingCards } from '@/components/landing/AgentLivingCards';
import { REGISTER } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'AI Agents — Nexora OS',
  description: 'Specialist AI agents for Slack, Jira, Notion, and Gmail — sharing one Action OS, memory, and approval layer.',
};

export default function AiAgentsPage() {
  return (
    <MarketingShell
      title="AI Agents"
      subtitle="Purpose-built specialists that share one operating system — same approvals, memory, and execution pipeline as chat."
    >
      <AgentLivingCards />
      <p className="mt-10 max-w-2xl text-sm leading-7 text-neutral-400">
        Agents are not separate chatbots. They use the same intent → plan → approve → execute engine as typed chat and
        voice input — with workspace isolation and real connector credentials.
      </p>
      <Link href={REGISTER} className="mt-8 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]">
        Open workspace
      </Link>
    </MarketingShell>
  );
}
