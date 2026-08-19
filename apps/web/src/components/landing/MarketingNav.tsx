'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const DEFAULT_LINKS = [
  { href: '#features', label: 'Why Nexora', hash: true },
  { href: '#product', label: 'Product', hash: true },
  { href: '#analysis', label: 'Analysis', hash: true },
  { href: '#agents', label: 'Agents', hash: true },
  { href: '#integrations', label: 'Integrations', hash: true },
] as const;

type NavLink = { href: string; label: string; hash?: boolean };

/**
 * Fixed header — logo left, floating glass pill nav center, actions right.
 * Stays put while scrolling (no hide/reveal).
 */
export function MarketingNav({
  links = DEFAULT_LINKS as unknown as NavLink[],
}: {
  links?: NavLink[];
}) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [activeHash, setActiveHash] = useState('');

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 16);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const ids = links
      .map((l) => l.href.replace(/^\/?#/, ''))
      .filter(Boolean);
    if (!ids.length) return;

    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);

    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) setActiveHash(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.1, 0.35, 0.6] }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [links]);

  function isActive(item: NavLink) {
    const id = item.href.replace(/^\/?#/, '');
    if (item.hash || item.href.includes('#')) return activeHash === id;
    return pathname === item.href;
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div
        className={cn(
          'pointer-events-auto mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 transition-all duration-300 ease-out sm:px-6 sm:py-4',
          scrolled && 'py-2.5 sm:py-3'
        )}
      >
        {/* Logo */}
        <Link href="/" className="relative z-10 flex shrink-0 items-center gap-2.5">
          <span className="relative h-9 w-9 overflow-hidden rounded-2xl">
            <Image src="/nexora-logo.png" alt="Nexora" fill className="object-contain" sizes="36px" />
          </span>
          <span className="font-display text-sm font-semibold tracking-[0.2em] text-white">NEXORA</span>
        </Link>

        {/* Floating glass pill — stays fixed, does not slide away */}
        <nav
          className={cn(
            'absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border px-1.5 py-1.5 lg:flex',
            'border-white/15 bg-[rgba(10,10,15,0.55)] shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
          )}
          style={{
            WebkitBackdropFilter: 'blur(22px)',
            backdropFilter: 'blur(22px)',
          }}
          aria-label="Primary"
        >
          {links.map((item) => {
            const active = isActive(item);
            const className = cn(
              'rounded-full px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors duration-300',
              active
                ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                : 'text-neutral-400 hover:text-white'
            );
            const isHash = item.hash || item.href.includes('#');
            return isHash ? (
              <a key={item.href} href={item.href} className={className}>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={className}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="relative z-10 flex shrink-0 items-center gap-2">
          <Link href="/login" className="hidden rounded-full px-4 py-2 text-sm text-neutral-300 hover:text-white sm:inline">
            Login
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#04101f] hover:bg-[#7db6ff]"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}
