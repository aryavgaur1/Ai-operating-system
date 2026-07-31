import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'About — Nexora OS',
  description: 'Nexora is an AI Operating System for modern teams.',
};

export default function AboutPage() {
  return (
    <MarketingShell title="About Nexora" subtitle="We build the operating layer between AI and the tools teams already use.">
      <div className="max-w-2xl space-y-4 text-sm leading-7 text-neutral-400">
        <p>
          Nexora is not a chatbot. It is an AI Operating System that connects apps, reasons over context, plans
          multi-step work, and executes against live APIs — with approvals when the stakes are high.
        </p>
        <p>
          Our north star is simple: one AI, every tool, complete automation — with enterprise trust built in.
        </p>
      </div>
    </MarketingShell>
  );
}
