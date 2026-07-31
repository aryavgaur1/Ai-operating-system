import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'Privacy — Nexora OS',
  description: 'Nexora privacy policy overview.',
};

export default function PrivacyPage() {
  return (
    <MarketingShell title="Privacy" subtitle="How we handle workspace data.">
      <div className="max-w-2xl space-y-4 text-sm leading-7 text-neutral-400">
        <p>We process account and workspace data to provide the Nexora OS service. Tokens and credentials are stored securely and scoped to your organization.</p>
        <p>Contact us for a full privacy policy package during enterprise diligence.</p>
      </div>
    </MarketingShell>
  );
}
