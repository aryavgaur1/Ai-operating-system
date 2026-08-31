'use client';

import { SmoothScroll } from '@/components/landing/SmoothScroll';
import { MarketingNav } from '@/components/landing/MarketingNav';
import { MarketingFooter } from '@/components/landing/MarketingFooter';
import { ChatAssistant } from '@/components/landing/ChatAssistant';
import { MARKETING_NAV_LINKS } from '@/lib/marketingNav';

export function MarketingShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#05060a] text-white">
      <SmoothScroll />
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(91,157,255,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-noise opacity-40" />
      </div>

      <MarketingNav links={MARKETING_NAV_LINKS.map((l) => ({ href: l.href, label: l.label }))} />

      {(title || subtitle) && (
        <section className="mx-auto max-w-7xl px-4 pb-8 pt-28 sm:px-6 sm:pt-32">
          {title && (
            <h1 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h1>
          )}
          {subtitle && <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-400">{subtitle}</p>}
        </section>
      )}

      <main className={`mx-auto max-w-7xl px-4 pb-20 sm:px-6 ${!(title || subtitle) ? 'pt-28 sm:pt-32' : ''}`}>
        {children}
      </main>

      <MarketingFooter />
      <ChatAssistant />
    </div>
  );
}
