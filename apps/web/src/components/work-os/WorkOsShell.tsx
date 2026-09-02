'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { APP_ROUTES } from '@/lib/routes';
import { WorkOsHeader } from '@/components/work-os/WorkOsHeader';
import { WorkOsSidebar } from '@/components/work-os/WorkOsSidebar';

export function WorkOsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileNav, setMobileNav] = useState(false);
  const isCommand = pathname?.startsWith(APP_ROUTES.chat);

  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNav) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileNav(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNav]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-[#04101f]"
      >
        Skip to content
      </a>

      <WorkOsHeader onMenuToggle={() => setMobileNav((o) => !o)} menuOpen={mobileNav} />

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-white/10 bg-[#0a0c11] lg:block" aria-label="Primary">
          <WorkOsSidebar />
        </aside>

        {mobileNav ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button
              type="button"
              className="absolute inset-0 bg-black/60"
              aria-label="Close navigation"
              onClick={() => setMobileNav(false)}
            />
            <aside className="relative z-50 h-full w-64 border-r border-white/10 bg-[#0a0c11] shadow-lg">
              <WorkOsSidebar onNavigate={() => setMobileNav(false)} />
            </aside>
          </div>
        ) : null}

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'min-w-0 flex-1 outline-none',
            isCommand ? 'pb-0' : 'mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8'
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
