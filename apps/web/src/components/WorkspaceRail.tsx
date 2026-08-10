'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { LayoutGrid, MessageSquare, ShieldCheck, Plug, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_ROUTES } from '@/lib/routes';
import { api } from '@/lib/api';

const ITEMS = [
  { href: APP_ROUTES.dashboard, label: 'Dashboard', icon: LayoutGrid },
  { href: APP_ROUTES.chat, label: 'Chat', icon: MessageSquare },
  { href: APP_ROUTES.approvals, label: 'Approvals', icon: ShieldCheck, badgeKey: 'approvals' as const },
  { href: APP_ROUTES.integrations, label: 'Integrations', icon: Plug },
];

export function WorkspaceRail() {
  const pathname = usePathname();
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await api.listApprovals('pending');
        if (!cancelled) setPendingApprovals((res.approvals || []).filter((a) => a.status === 'pending').length);
      } catch {
        // ignore when logged out
      }
    }
    refresh();
    const id = window.setInterval(refresh, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      className="fixed left-6 top-1/2 z-40 hidden -translate-y-1/2 xl:flex"
    >
      <div className="glass-strong flex flex-col items-center gap-2 rounded-[26px] p-2.5">
        <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/30 to-accent2/20 text-accent">
          <Sparkles size={15} />
        </div>
        <div className="h-px w-6 bg-white/10" />
        {ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          const badge = item.badgeKey === 'approvals' ? pendingApprovals : 0;
          return (
            <Link key={item.href} href={item.href} className="group relative">
              <span
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-2xl transition-all',
                  active
                    ? 'bg-accent/15 text-accent shadow-[0_0_0_1px_rgba(91,157,255,0.3)]'
                    : 'text-neutral-500 hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon size={16} />
                {badge > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-400 px-1 text-[9px] font-bold text-black">
                    {badge > 9 ? '9+' : badge}
                  </span>
                ) : null}
              </span>
              <span className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#0b0d12] px-2.5 py-1.5 text-xs text-neutral-200 opacity-0 shadow-soft transition-all group-hover:opacity-100">
                {item.label}
                {badge > 0 ? ` · ${badge} pending` : ''}
              </span>
            </Link>
          );
        })}
        <div className="h-px w-6 bg-white/10" />
        <Link
          href={APP_ROUTES.settings}
          className={cn(
            'group relative flex h-10 w-10 items-center justify-center rounded-2xl transition-all',
            pathname?.startsWith(APP_ROUTES.settings)
              ? 'bg-accent/15 text-accent shadow-[0_0_0_1px_rgba(91,157,255,0.3)]'
              : 'text-neutral-500 hover:bg-white/5 hover:text-white'
          )}
        >
          <Settings size={16} />
          <span className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#0b0d12] px-2.5 py-1.5 text-xs text-neutral-200 opacity-0 shadow-soft transition-all group-hover:opacity-100">
            Settings
          </span>
        </Link>
      </div>
    </motion.aside>
  );
}
