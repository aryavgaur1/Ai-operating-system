'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { MARKETING_PRIMARY_NAV } from '@/lib/marketingNav';
import { cn } from '@/lib/utils';

type NavLink = { href: string; label: string };

/**
 * Fixed header — logo left, floating glass pill nav center, actions right.
 */
export function MarketingNav({ links = MARKETING_PRIMARY_NAV }: { links?: NavLink[] }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 16);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div
        className={cn(
          'pointer-events-auto mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 transition-all duration-300 ease-out sm:px-6 sm:py-4',
          scrolled && 'py-2.5 sm:py-3'
        )}
      >
        <Link href="/" className="relative z-10 flex shrink-0 items-center gap-2.5">
          <span className="relative h-9 w-9 overflow-hidden rounded-2xl">
            <Image src="/nexora-logo.png" alt="Nexora" fill className="object-contain" sizes="36px" />
          </span>
          <span className="font-display text-sm font-semibold tracking-[0.2em] text-white">NEXORA</span>
        </Link>

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
          <Link
            href="/"
            className={cn(
              'rounded-full px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors duration-300',
              pathname === '/'
                ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                : 'text-neutral-400 hover:text-white'
            )}
          >
            Home
          </Link>
          {links.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors duration-300',
                  active
                    ? 'bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                    : 'text-neutral-400 hover:text-white'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative z-10 flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white lg:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
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

      {mobileOpen && (
        <div className="pointer-events-auto border-b border-white/10 bg-[#05060a]/95 px-4 py-4 backdrop-blur-xl lg:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            <Link
              href="/"
              className={cn(
                'rounded-xl px-4 py-3 text-sm',
                pathname === '/' ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5'
              )}
            >
              Home
            </Link>
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-xl px-4 py-3 text-sm',
                  pathname === item.href ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
