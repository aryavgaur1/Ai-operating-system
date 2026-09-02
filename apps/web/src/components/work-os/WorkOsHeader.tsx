'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Menu, Search, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, clearSession } from '@/lib/api';
import { APP_ROUTES, LOGIN, chatResumeHref } from '@/lib/routes';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { useWorkspaces } from '@/components/WorkspaceProvider';

export function WorkOsHeader({
  onMenuToggle,
  menuOpen,
}: {
  onMenuToggle: () => void;
  menuOpen: boolean;
}) {
  const router = useRouter();
  const { current } = useWorkspaces();
  const [displayName, setDisplayName] = useState('User');
  const [email, setEmail] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [profileCoords, setProfileCoords] = useState<{ top: number; right: number } | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setDisplayName(res.user.displayName || res.user.email);
        setEmail(res.user.email || '');
      })
      .catch(() => undefined);
  }, [current?.organizationId]);

  useLayoutEffect(() => {
    if (!profileOpen) return;
    function place() {
      const el = profileButtonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setProfileCoords({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (profileButtonRef.current?.contains(t) || profileMenuRef.current?.contains(t)) return;
      setProfileOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (q) {
      router.push(`${chatResumeHref()}?q=${encodeURIComponent(q)}`);
    } else {
      router.push(chatResumeHref());
    }
  }

  const roleLabel = current?.role ? current.role.charAt(0).toUpperCase() + current.role.slice(1) : 'Member';
  const kindLabel = current?.kind === 'team' ? 'Team' : 'Personal';

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#090b10]/95 backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
        <button
          type="button"
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-300 hover:bg-white/5 lg:hidden"
          onClick={onMenuToggle}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link
          href={APP_ROUTES.overview}
          className="focus-ring font-display shrink-0 rounded-md text-sm font-semibold tracking-tight text-white"
        >
          Nexora
        </Link>

        <div className="hidden h-5 w-px bg-white/10 sm:block" aria-hidden />

        <div className="hidden min-w-0 sm:block">
          <WorkspaceSwitcher compact />
        </div>

        <div className="hidden text-xs text-neutral-500 xl:block">
          <span className="text-neutral-400">{kindLabel}</span>
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          <span>{roleLabel}</span>
        </div>

        <form onSubmit={onSearchSubmit} className="ml-auto hidden max-w-md flex-1 md:flex" role="search">
          <label htmlFor="work-os-search" className="sr-only">
            Search or ask Nexora
          </label>
          <div className="relative w-full">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden />
            <input
              id="work-os-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ask Nexora or search work…"
              className="nx-input py-2 pl-9 pr-3"
            />
          </div>
        </form>

        <button
          ref={profileButtonRef}
          type="button"
          onClick={() => setProfileOpen((o) => !o)}
          aria-expanded={profileOpen}
          aria-haspopup="menu"
          className={cn(
            'focus-ring ml-auto flex h-9 items-center gap-2 rounded-md border border-white/10 px-2.5 text-sm text-neutral-200 hover:bg-white/5 md:ml-0',
            profileOpen && 'border-white/20 bg-white/5'
          )}
        >
          <User size={15} aria-hidden />
          <span className="hidden max-w-[120px] truncate sm:inline">{displayName}</span>
        </button>
      </div>

      <div className="border-t border-white/5 px-3 py-2 sm:hidden">
        <WorkspaceSwitcher compact />
      </div>

      {mounted && profileOpen && profileCoords
        ? createPortal(
            <div
              ref={profileMenuRef}
              role="menu"
              style={{ position: 'fixed', top: profileCoords.top, right: profileCoords.right, zIndex: 9999 }}
              className="w-56 rounded-lg border border-white/10 bg-[#0f1117] p-2 shadow-lg"
            >
              <div className="border-b border-white/10 px-3 py-2">
                <div className="truncate text-sm font-medium text-white">{displayName}</div>
                <div className="truncate text-xs text-neutral-500">{email}</div>
              </div>
              <Link
                href={APP_ROUTES.settings}
                role="menuitem"
                className="focus-ring mt-1 block rounded-md px-3 py-2 text-sm text-neutral-300 hover:bg-white/5"
                onClick={() => setProfileOpen(false)}
              >
                Account settings
              </Link>
              <button
                type="button"
                role="menuitem"
                className="focus-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-rose-300 hover:bg-white/5"
                onClick={() => {
                  clearSession();
                  router.push(LOGIN);
                }}
              >
                <LogOut size={14} aria-hidden />
                Sign out
              </button>
            </div>,
            document.body
          )
        : null}
    </header>
  );
}
