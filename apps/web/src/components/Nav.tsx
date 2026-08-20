'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Bell,
  LayoutGrid,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Plug,
  Search,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { api, clearSession } from '@/lib/api';
import { APP_HOME, APP_ROUTES, LOGIN, chatResumeHref } from '@/lib/routes';
import { resolveChatHref } from '@/lib/activeConversation';
import { isPlatformAdminEmail } from '@/lib/platformAdmin';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { resetJarvisSessionGuards } from '@/components/JarvisProvider';

const STATIC_LINKS = [
  { href: APP_ROUTES.dashboard, label: 'Dashboard', icon: LayoutGrid },
  { href: APP_ROUTES.approvals, label: 'Approvals', icon: ShieldCheck },
  { href: APP_ROUTES.integrations, label: 'Integrations', icon: Plug },
  { href: APP_ROUTES.workspaceSettings, label: 'Workspace', icon: Users },
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
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [newUsers24h, setNewUsers24h] = useState(0);
  const [liveNotifs, setLiveNotifs] = useState<{ id: string; text: string; time: string; href?: string }[]>([]);
  const [chatHref, setChatHref] = useState<string>(() => chatResumeHref());
  const [mounted, setMounted] = useState(false);
  const [notifCoords, setNotifCoords] = useState<{ top: number; right: number } | null>(null);
  const [profileCoords, setProfileCoords] = useState<{ top: number; right: number } | null>(null);
  const notifButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const notifMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Prefer last known concrete chat href; do not flash bare /app/chat while resume loads.
    const hinted = chatResumeHref();
    if (hinted !== APP_ROUTES.chat) setChatHref(hinted);
    (async () => {
      try {
        const href = await resolveChatHref();
        if (!cancelled) setChatHref(href);
      } catch {
        // keep hint / last concrete href — bare /app/chat still server-resolves
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const LINKS = [
    STATIC_LINKS[0],
    STATIC_LINKS[1],
    { href: chatHref, label: 'Chat', icon: MessageSquare, matchPrefix: APP_ROUTES.chat },
    STATIC_LINKS[2],
    {
      ...STATIC_LINKS[3],
      matchPrefix: APP_ROUTES.workspaceSettings,
    },
  ];

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
    let cancelled = false;
    async function refreshNotifs() {
      try {
        const approvals = await api.listApprovals('pending');
        const pending = (approvals.approvals || []).filter((a) => a.status === 'pending');
        if (cancelled) return;
        setPendingApprovals(pending.length);
        const items: { id: string; text: string; time: string; href?: string }[] = [];
        if (pending.length > 0) {
          items.push({
            id: 'approvals',
            text: `${pending.length} action${pending.length === 1 ? '' : 's'} awaiting Approve & run`,
            time: 'now',
            href: APP_ROUTES.approvals,
          });
        }
        if (isPlatformAdminEmail(email)) {
          try {
            const m = await api.adminMetrics();
            if (cancelled) return;
            const n = Number(m.newUsersLast24h || 0);
            setNewUsers24h(n);
            if (n > 0) {
              items.push({
                id: 'users',
                text: `${n} new user${n === 1 ? '' : 's'} in the last 24h (Google + email)`,
                time: 'today',
                href: APP_ROUTES.admin,
              });
            }
          } catch {
            // non-admin / fail quiet
          }
        }
        if (items.length === 0) {
          items.push({
            id: 'idle',
            text: 'Approvals and new signups will show up here live',
            time: 'now',
          });
        }
        setLiveNotifs(items);
      } catch {
        // ignore
      }
    }
    refreshNotifs();
    const id = window.setInterval(refreshNotifs, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [email]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onCloseOthers(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== 'notif') setNotifOpen(false);
      if (detail !== 'profile') setProfileOpen(false);
    }
    window.addEventListener('nexora:close-overlays', onCloseOthers as EventListener);
    return () => window.removeEventListener('nexora:close-overlays', onCloseOthers as EventListener);
  }, []);

  useLayoutEffect(() => {
    if (!notifOpen) return;
    function place() {
      const el = notifButtonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setNotifCoords({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [notifOpen]);

  useLayoutEffect(() => {
    if (!profileOpen) return;
    function place() {
      const el = profileButtonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setProfileCoords({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
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
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (notifOpen) {
        if (!notifButtonRef.current?.contains(t) && !notifMenuRef.current?.contains(t)) {
          setNotifOpen(false);
        }
      }
      if (profileOpen) {
        if (!profileButtonRef.current?.contains(t) && !profileMenuRef.current?.contains(t)) {
          setProfileOpen(false);
        }
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [notifOpen, profileOpen]);

  async function signOut() {
    setProfileOpen(false);
    try {
      await api.logout();
    } catch {
      // ignore
    }
    clearSession();
    resetJarvisSessionGuards();
    router.push(LOGIN);
  }

  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const isAdmin = isPlatformAdminEmail(email);
  const notifDot = pendingApprovals > 0 || newUsers24h > 0;

  const notifMenu =
    mounted &&
    notifOpen &&
    notifCoords &&
    createPortal(
      <motion.div
        ref={notifMenuRef}
        initial={{ opacity: 0, y: -8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16 }}
        style={{ top: notifCoords.top, right: notifCoords.right }}
        className="menu-panel fixed z-[300] w-80 rounded-2xl p-2"
      >
        <div className="px-3 py-2 text-xs uppercase tracking-[0.2em] text-neutral-500">Notifications</div>
        <div className="space-y-1">
          {liveNotifs.map((n) =>
            n.href ? (
              <Link
                key={n.id}
                href={n.href}
                onClick={() => setNotifOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/5"
              >
                <div className="text-neutral-200">{n.text}</div>
                <div className="mt-0.5 text-[11px] text-neutral-500">{n.time}</div>
              </Link>
            ) : (
              <div key={n.id} className="rounded-xl px-3 py-2.5 text-sm">
                <div className="text-neutral-200">{n.text}</div>
                <div className="mt-0.5 text-[11px] text-neutral-500">{n.time}</div>
              </div>
            )
          )}
        </div>
      </motion.div>,
      document.body
    );

  const profileMenu =
    mounted &&
    profileOpen &&
    profileCoords &&
    createPortal(
      <motion.div
        ref={profileMenuRef}
        initial={{ opacity: 0, y: -8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16 }}
        style={{ top: profileCoords.top, right: profileCoords.right }}
        className="menu-panel fixed z-[300] w-64 rounded-2xl p-2"
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
        <div className="my-1 h-px bg-white/10" />
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
            {newUsers24h > 0 ? ` · ${newUsers24h} new` : ''}
          </Link>
        )}
        <Link
          href={APP_ROUTES.workspaceSettings}
          onClick={() => setProfileOpen(false)}
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"
        >
          <Users size={14} /> Workspace · members & invites
        </Link>
        <div className="my-1 h-px bg-white/10" />
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
        >
          <LogOut size={14} /> Sign out
        </button>
      </motion.div>,
      document.body
    );

  return (
    <div className="sticky top-4 z-[200] overflow-visible px-4 sm:px-6">
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
        className="glass-strong relative z-[200] mx-auto flex max-w-7xl items-center gap-3 overflow-visible rounded-[26px] px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3"
      >
        <Link href={APP_HOME} className="flex shrink-0 items-center gap-2.5 pr-1">
          <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/30 to-accent2/20 text-accent shadow-glow">
            <Sparkles size={16} strokeWidth={2.4} />
          </span>
          <span className="hidden font-display text-sm font-semibold tracking-[0.18em] text-white lg:inline">
            NEXORA&nbsp;OS
          </span>
        </Link>

        <div className="min-w-0 shrink-0">
          <WorkspaceSwitcher compact />
        </div>

        <nav className="hidden min-w-0 items-center gap-0.5 rounded-full border border-white/8 bg-black/20 p-1 md:flex">
          {LINKS.map((link) => {
            const matchPrefix = 'matchPrefix' in link && link.matchPrefix ? link.matchPrefix : link.href;
            const active = pathname?.startsWith(matchPrefix);
            const Icon = link.icon;
            const showApprovalBadge = matchPrefix === APP_ROUTES.approvals && pendingApprovals > 0;
            return (
              <Link key={`${link.label}:${link.href}`} href={link.href} prefetch={false} className="relative">
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-white/10 shadow-[0_0_0_1px_rgba(91,157,255,0.35)]"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span
                  className={cn(
                    'relative z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] transition-colors xl:gap-1.5 xl:px-3.5 xl:py-2 xl:text-sm',
                    active ? 'text-white' : 'text-neutral-400 hover:text-white'
                  )}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="whitespace-nowrap">{link.label}</span>
                  {showApprovalBadge ? (
                    <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-400 px-1 text-[9px] font-bold text-black">
                      {pendingApprovals > 9 ? '9+' : pendingApprovals}
                    </span>
                  ) : null}
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
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-emerald-300 2xl:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            core online
          </span>
          <span className="hidden items-center rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-[11px] text-accent 2xl:flex">
            18ms latency
          </span>
          {isAdmin && (
            <Link
              href={APP_ROUTES.admin}
              className="relative hidden rounded-full border border-white/10 px-3 py-1 text-[11px] text-neutral-300 hover:text-white sm:inline"
            >
              Admin
              {newUsers24h > 0 ? (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent2/90 px-1 text-[9px] font-bold text-black">
                  {newUsers24h > 9 ? '9+' : newUsers24h}
                </span>
              ) : null}
            </Link>
          )}

          <div className="relative">
            <button
              ref={notifButtonRef}
              onClick={() => {
                setNotifOpen((v) => {
                  const next = !v;
                  if (next) {
                    window.dispatchEvent(new CustomEvent('nexora:close-overlays', { detail: 'notif' }));
                    setProfileOpen(false);
                  }
                  return next;
                });
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/8 bg-white/5 text-neutral-300 transition hover:border-accent/40 hover:text-white"
            >
              <Bell size={15} />
              {notifDot ? <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent2" /> : null}
            </button>
          </div>

          <div className="relative">
            <button
              ref={profileButtonRef}
              onClick={() => {
                setProfileOpen((v) => {
                  const next = !v;
                  if (next) {
                    window.dispatchEvent(new CustomEvent('nexora:close-overlays', { detail: 'profile' }));
                    setNotifOpen(false);
                  }
                  return next;
                });
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent/60 to-violet/60 text-xs font-semibold text-white shadow-glow"
            >
              {initials}
            </button>
          </div>
        </div>
      </motion.header>
      {notifMenu}
      {profileMenu}

      <nav className="glass fixed bottom-3 left-3 right-3 z-[190] flex items-center gap-1 overflow-x-auto rounded-2xl p-1.5 md:hidden">
        {LINKS.map((link) => {
          const matchPrefix = 'matchPrefix' in link && link.matchPrefix ? link.matchPrefix : link.href;
          const active = pathname?.startsWith(matchPrefix);
          const Icon = link.icon;
          const showApprovalBadge = matchPrefix === APP_ROUTES.approvals && pendingApprovals > 0;
          return (
            <Link
              key={link.label}
              href={link.href}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[10px] transition-colors sm:flex-row sm:gap-1.5 sm:px-3.5 sm:text-xs',
                active ? 'bg-white/10 text-white' : 'text-neutral-400'
              )}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{link.label}</span>
              {showApprovalBadge ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-400 px-1 text-[9px] font-bold text-black">
                  {pendingApprovals > 9 ? '9+' : pendingApprovals}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
