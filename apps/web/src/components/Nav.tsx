'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  LayoutGrid,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Plug,
  Search,
  Settings,
  Sparkles,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { api, setAccessToken } from '@/lib/api';
import { APP_HOME, APP_ROUTES, LOGIN } from '@/lib/routes';
import { isPlatformAdminEmail } from '@/lib/platformAdmin';

const NOTIFICATIONS = [
  { id: 1, text: 'Approvals and integrations update live from your workspace', time: 'now' },
];

const LINKS = [
  { href: APP_ROUTES.dashboard, label: 'Dashboard', icon: LayoutGrid },
  { href: APP_ROUTES.chat, label: 'Chat', icon: MessageSquare },
  { href: APP_ROUTES.approvals, label: 'Approvals', icon: ShieldCheck },
  { href: APP_ROUTES.integrations, label: 'Integrations', icon: Plug },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [searchFocused, setSearchFocused] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [displayName, setDisplayName] = useState('User');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [isVerified, setIsVerified] = useState(true);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setDisplayName(res.user.displayName || res.user.email);
        setEmail(res.user.email || '');
        setRole(res.user.role);
        setIsVerified(Boolean(res.user.isVerified));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function signOut() {
    setProfileOpen(false);
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAccessToken(null);
    router.push(LOGIN);
  }

  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const isAdmin = isPlatformAdminEmail(email);

  return (
    <div className="sticky top-4 z-50 px-4 sm:px-6">
      {!isVerified && (
        <div className="mx-auto mb-2 flex max-w-7xl items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
          <span>Verify your email to unlock chat and approvals.</span>
          <button
            type="button"
            className="rounded-full border border-amber-400/30 px-3 py-1 hover:bg-amber-500/20"
            onClick={() => api.resendVerification().catch(() => undefined)}
          >
            Resend link
          </button>
        </div>
      )}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="glass-strong mx-auto flex max-w-7xl items-center gap-3 rounded-[26px] px-4 py-3 sm:px-5"
      >
        <Link href={APP_HOME} className="flex shrink-0 items-center gap-2.5">
          <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/30 to-accent2/20 text-accent shadow-glow">
            <Sparkles size={16} strokeWidth={2.4} />
          </span>
          <span className="hidden font-display text-sm font-semibold tracking-[0.18em] text-white sm:inline">
            NEXORA&nbsp;OS
          </span>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-white/8 bg-black/20 p-1 md:flex">
          {LINKS.map((link) => {
            const active = pathname?.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className="relative">
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-white/10 shadow-[0_0_0_1px_rgba(91,157,255,0.35)]"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span
                  className={cn(
                    'relative z-10 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors',
                    active ? 'text-white' : 'text-neutral-400 hover:text-white'
                  )}
                >
                  <Icon size={14} />
                  {link.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto hidden max-w-xs flex-1 items-center lg:flex">
          <Search size={14} className="pointer-events-none absolute left-3.5 text-neutral-500" />
          <input
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search workspace…"
            className={cn(
              'w-full rounded-full border bg-black/20 py-2 pl-9 pr-3 text-xs text-neutral-200 outline-none transition-all placeholder:text-neutral-500',
              searchFocused ? 'border-accent/50 bg-black/30 ring-2 ring-accent/20' : 'border-white/8'
            )}
          />
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-emerald-300 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            core online
          </span>
          <span className="hidden items-center rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-[11px] text-accent xl:flex">
            18ms latency
          </span>
          {isAdmin && (
            <Link href={APP_ROUTES.admin} className="hidden rounded-full border border-white/10 px-3 py-1 text-[11px] text-neutral-300 hover:text-white sm:inline">
              Admin
            </Link>
          )}

          <div ref={notifRef} className="relative">
            <button
              onClick={() => {
                setNotifOpen((v) => !v);
                setProfileOpen(false);
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/8 bg-white/5 text-neutral-300 transition hover:border-accent/40 hover:text-white"
            >
              <Bell size={15} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent2" />
            </button>
            <AnimatePresence>
              {notifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                  className="glass-strong absolute right-0 top-12 w-80 rounded-2xl p-2 shadow-soft"
                >
                  <div className="px-3 py-2 text-xs uppercase tracking-[0.2em] text-neutral-500">Notifications</div>
                  <div className="space-y-1">
                    {NOTIFICATIONS.map((n) => (
                      <div key={n.id} className="rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/5">
                        <div className="text-neutral-200">{n.text}</div>
                        <div className="mt-0.5 text-[11px] text-neutral-500">{n.time}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div ref={profileRef} className="relative">
            <button
              onClick={() => {
                setProfileOpen((v) => !v);
                setNotifOpen(false);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent/60 to-violet/60 text-xs font-semibold text-white shadow-glow"
            >
              {initials}
            </button>
            <AnimatePresence>
              {profileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                  className="glass-strong absolute right-0 top-12 w-64 rounded-2xl p-2 shadow-soft"
                >
                  <div className="flex items-center gap-3 px-3 py-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent/60 to-violet/60 text-xs font-semibold text-white">
                      {initials}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{displayName}</div>
                      <div className="truncate text-xs text-neutral-500">{role.replace('_', ' ')}</div>
                    </div>
                  </div>
                  <div className="my-1 h-px bg-white/8" />
                  <Link
                    href={APP_ROUTES.settings}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"
                  >
                    <User size={14} /> Account settings
                  </Link>
                  {isAdmin && (
                    <Link
                      href={APP_ROUTES.admin}
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"
                    >
                      <ShieldCheck size={14} /> Admin panel
                    </Link>
                  )}
                  <Link
                    href={APP_ROUTES.settings}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"
                  >
                    <Settings size={14} /> Workspace settings
                  </Link>
                  <div className="my-1 h-px bg-white/8" />
                  <button
                    onClick={signOut}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.header>

      <nav className="glass mx-auto mt-3 flex max-w-7xl items-center gap-1 overflow-x-auto rounded-2xl p-1.5 md:hidden">
        {LINKS.map((link) => {
          const active = pathname?.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs transition-colors',
                active ? 'bg-white/10 text-white' : 'text-neutral-400'
              )}
            >
              <Icon size={13} />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
