'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/chat', label: 'Chat' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/integrations', label: 'Integrations' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#05060a]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/dashboard" className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.22em] text-neutral-200">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/15 text-accent shadow-glow">NX</span>
          <span className="text-white">Nexora OS</span>
        </Link>

        <div className="hidden items-center gap-3 sm:flex">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-neutral-400">core online</span>
          <span className="rounded-full border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">neural latency 18ms</span>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          {LINKS.map((link) => {
            const active = pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  active
                    ? 'border-accent bg-accent/10 text-white shadow-[0_0_0_1px_rgba(77,159,255,0.25)]'
                    : 'border-white/10 text-neutral-400 hover:border-accent hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
