import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'Contact — Nexora OS',
  description: 'Contact the Nexora team.',
};

export default function ContactPage() {
  return (
    <MarketingShell title="Contact" subtitle="Book a demo or reach the team.">
      <div className="glass max-w-lg rounded-[24px] p-6 text-sm text-neutral-300">
        <p>Email: <span className="text-white">hello@nexora.ai</span></p>
        <p className="mt-3 text-neutral-500">For enterprise demos, include your company and stack in the subject line.</p>
      </div>
    </MarketingShell>
  );
}
