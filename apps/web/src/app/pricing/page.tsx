import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';
import { PricingSection } from '@/components/landing/PricingSection';

export const metadata: Metadata = {
  title: 'Pricing — Nexora OS',
  description: 'First 365 days are free. Advanced is for seats, audit export, SSO, and private deploy.',
};

export default function PricingPage() {
  return (
    <MarketingShell
      title="Pricing"
      subtitle="First 365 days are free. Advanced is a paid upgrade when you need seats, audit export, SSO/SAML, SLAs, or a private deploy."
    >
      <PricingSection heading={false} />
    </MarketingShell>
  );
}
