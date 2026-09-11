'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { NexoraLockup } from '@/components/NexoraMark';
import { MARKETING_PRIMARY_NAV } from '@/lib/marketingNav';
import { cn } from '@/lib/utils';

type NavLink = { href: string; label: string };

/**
 * Fixed header — lockup left, links center, actions right.
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
        <Link href="/" className="relative z-10 shrink-0">
          <NexoraLockup markClassName="h-9 w-9" />
        </Link>

        <nav
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 lg:flex"
          aria-label="Primary"
        >
          <Link
            href="/"
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              pathname === '/' ? 'text-white' : 'text-neutral-400 hover:text-white'
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
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  active ? 'text-white' : 'text-neutral-400 hover:text-white'
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
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0b0d12] hover:bg-neutral-200"
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
