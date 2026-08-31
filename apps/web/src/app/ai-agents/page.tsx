import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { FeaturedAgentsDetail } from '@/components/landing/FeaturedAgentsDetail';

export const metadata: Metadata = {
  title: 'Nexora OS — AI Agents',
  description: 'Four focused Nexora agents for Slack, Jira, Notion, and Gmail — one Action OS, shared approvals, and real execution.',
};

export default function AiAgentsPage() {
  return (
    <MarketingShell
      title="AI Agents"
      subtitle="Four focused specialists on one operating system — same intent → plan → approve → execute pipeline as chat."
    >
      <FeaturedAgentsDetail />
    </MarketingShell>
  );
}
