import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'Terms — Nexora OS',
  description: 'Nexora terms of use overview.',
};

export default function TermsPage() {
  return (
    <MarketingShell title="Terms" subtitle="Terms of use overview.">
      <div className="max-w-2xl space-y-4 text-sm leading-7 text-neutral-400">
        <p>By using Nexora you agree to use the service lawfully and respect the access controls of connected tools.</p>
        <p>Enterprise agreements may supersede these overview terms.</p>
      </div>
    </MarketingShell>
  );
}
