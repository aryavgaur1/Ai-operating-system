import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { FeaturedAgentsDetail } from '@/components/landing/FeaturedAgentsDetail';

export const metadata: Metadata = {
  title: 'Nexora OS — AI Agents',
  description: 'Four Nexora agents — Research, Support, Operations, and Developer — on one operating system with shared memory and approvals.',
};

export default function AiAgentsPage() {
  return (
    <MarketingShell
      title="AI Agents"
      subtitle="Research, Support, Operations, and Developer. Same plan → approve → execute path as chat."
    >
      <FeaturedAgentsDetail />
    </MarketingShell>
  );
}
