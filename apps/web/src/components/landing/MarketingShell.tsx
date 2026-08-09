'use client';

import Link from 'next/link';
import { SmoothScroll } from '@/components/landing/SmoothScroll';
import { MarketingNav } from '@/components/landing/MarketingNav';
import { ChatAssistant } from '@/components/landing/ChatAssistant';

const SHELL_LINKS = [
  { href: '/#features', label: 'Why Nexora' },
  { href: '/#product', label: 'Product' },
  { href: '/#analysis', label: 'Analysis' },
  { href: '/#agents', label: 'Agents' },
  { href: '/integrations', label: 'Integrations' },
];

const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/integrations', label: 'Integrations' },
      { href: '/enterprise', label: 'Enterprise' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/docs', label: 'Documentation' },
      { href: '/docs', label: 'API' },
      { href: '/docs', label: 'Roadmap' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];

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

      <MarketingNav links={SHELL_LINKS} />

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

      <footer className="border-t border-white/5 py-14">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 md:grid-cols-4">
          <div>
            <div className="font-display tracking-[0.2em]">NEXORA</div>
            <p className="mt-3 text-sm text-neutral-500">The AI Operating System for modern teams.</p>
          </div>
          {FOOTER.map((col) => (
            <div key={col.title}>
              <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">{col.title}</div>
              <ul className="mt-4 space-y-2 text-sm text-neutral-400">
                {col.links.map((l) => (
                  <li key={`${col.title}-${l.label}`}>
                    <Link href={l.href} className="hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 max-w-7xl px-4 text-xs text-neutral-600 sm:px-6" suppressHydrationWarning>
          © {new Date().getFullYear()} Nexora OS
        </div>
      </footer>

      <ChatAssistant />
    </div>
  );
}
