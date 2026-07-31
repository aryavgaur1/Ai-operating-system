import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { REGISTER } from '@/lib/routes';

export const metadata: Metadata = {
  title: 'Pricing — Nexora OS',
  description: 'Simple plans for teams running an AI Operating System.',
};

const PLANS = [
  { name: 'Starter', price: '$0', items: ['1 workspace', 'Chat + approvals', 'Demo connectors'] },
  { name: 'Pro', price: '$49', items: ['Live tool execution', 'Memory + history', 'Priority latency'], featured: true },
  { name: 'Business', price: '$149', items: ['Seats & roles', 'Audit export', 'Shared workspaces'] },
  { name: 'Enterprise', price: 'Custom', items: ['SSO / SAML', 'Custom SLAs', 'Private deployment'] },
];

export default function PricingPage() {
  return (
    <MarketingShell title="Pricing" subtitle="Start free. Scale when your team is ready.">
      <div className="grid gap-4 lg:grid-cols-4">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={`rounded-[28px] border p-6 ${
              p.featured ? 'border-accent/40 bg-accent/10 shadow-glow' : 'border-white/8 bg-white/[0.03]'
            }`}
          >
            <div className="text-sm text-neutral-400">{p.name}</div>
            <div className="font-display mt-2 text-4xl text-white">{p.price}</div>
            <ul className="mt-5 space-y-2 text-sm text-neutral-300">
              {p.items.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
            <Link
              href={REGISTER}
              className="mt-6 inline-flex w-full items-center justify-center rounded-full border border-white/15 py-2.5 text-sm text-white hover:bg-white/5"
            >
              Get started
            </Link>
          </div>
        ))}
      </div>
    </MarketingShell>
  );
}
