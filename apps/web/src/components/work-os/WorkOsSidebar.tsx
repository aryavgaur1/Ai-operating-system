'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Mail,
  MessageSquare,
  Settings,
  ShieldCheck,
  Ticket,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_ROUTES, chatResumeHref } from '@/lib/routes';
import { resolveChatHref } from '@/lib/activeConversation';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { api } from '@/lib/api';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  matchPrefix: string;
  badge?: number;
};

function NavLink({
  item,
  onNavigate,
  hash,
}: {
  item: NavItem;
  onNavigate?: () => void;
  hash: string;
}) {
  const pathname = usePathname();
  const hashTarget = item.href.includes('#') ? item.href.split('#')[1] : null;
  const active = hashTarget
    ? pathname?.startsWith(item.matchPrefix) && hash === `#${hashTarget}`
    : pathname === item.href || pathname?.startsWith(`${item.matchPrefix}/`);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-ring flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
        active ? 'bg-white/10 text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
      )}
    >
      <Icon size={16} className={cn('shrink-0', active && 'text-accent')} aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge != null && item.badge > 0 ? (
        <span className="rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white" aria-label={`${item.badge} pending`}>
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
      {children}
    </div>
  );
}

export function WorkOsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { current } = useWorkspaces();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [chatHref, setChatHref] = useState(chatResumeHref());
  const [hash, setHash] = useState('');

  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const hinted = chatResumeHref();
    if (hinted !== APP_ROUTES.chat) setChatHref(hinted);
    resolveChatHref()
      .then((href) => {
        if (!cancelled) setChatHref(href);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    api
      .listApprovals('pending')
      .then((res) => {
        if (!cancelled) {
          setPendingApprovals((res.approvals || []).filter((a) => a.status === 'pending').length);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [current?.organizationId]);

  const workspaceItems: NavItem[] = [
    { href: APP_ROUTES.overview, label: 'Overview', icon: LayoutDashboard, matchPrefix: APP_ROUTES.overview },
    { href: APP_ROUTES.myWork, label: 'My Work', icon: ListTodo, matchPrefix: APP_ROUTES.myWork },
    { href: APP_ROUTES.projects, label: 'Projects', icon: FolderKanban, matchPrefix: APP_ROUTES.projects },
    {
      href: APP_ROUTES.approvals,
      label: 'Approvals',
      icon: ShieldCheck,
      matchPrefix: APP_ROUTES.approvals,
      badge: pendingApprovals,
    },
    { href: APP_ROUTES.activity, label: 'Activity', icon: Activity, matchPrefix: APP_ROUTES.activity },
  ];

  const connectionItems: NavItem[] = [
    { href: `${APP_ROUTES.integrations}#slack`, label: 'Slack', icon: MessageSquare, matchPrefix: APP_ROUTES.integrations },
    { href: `${APP_ROUTES.integrations}#gmail`, label: 'Gmail', icon: Mail, matchPrefix: APP_ROUTES.integrations },
    { href: `${APP_ROUTES.integrations}#notion`, label: 'Notion', icon: FileText, matchPrefix: APP_ROUTES.integrations },
    { href: `${APP_ROUTES.integrations}#jira`, label: 'Jira', icon: Ticket, matchPrefix: APP_ROUTES.integrations },
  ];

  const managementItems: NavItem[] = [
    ...(current?.kind === 'team'
      ? [{ href: APP_ROUTES.workspaceMembers, label: 'Members', icon: Users, matchPrefix: APP_ROUTES.workspaceMembers }]
      : []),
    {
      href: APP_ROUTES.workspaceSettings,
      label: 'Settings',
      icon: Settings,
      matchPrefix: APP_ROUTES.workspaceSettings,
    },
  ];

  const commandActive = pathname?.startsWith(APP_ROUTES.chat);

  return (
    <nav className="flex h-full flex-col py-4" aria-label="Workspace navigation">
      <div className="px-3 pb-3">
        <Link
          href={chatHref}
          prefetch={false}
          onClick={onNavigate}
          aria-current={commandActive ? 'page' : undefined}
          className={cn(
            'focus-ring flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm font-medium transition',
            commandActive
              ? 'border-accent/40 bg-accent/10 text-white'
              : 'border-white/10 bg-white/[0.03] text-neutral-200 hover:border-white/20'
          )}
        >
          <MessageSquare size={16} className="text-accent" aria-hidden />
          Command
        </Link>
      </div>

      <SectionLabel>Workspace</SectionLabel>
      <div className="space-y-0.5 px-2">
        {workspaceItems.map((item) => (
          <NavLink key={item.href + item.label} item={item} onNavigate={onNavigate} hash={hash} />
        ))}
      </div>

      <SectionLabel>Connections</SectionLabel>
      <div className="space-y-0.5 px-2">
        {connectionItems.map((item) => (
          <NavLink key={item.label} item={item} onNavigate={onNavigate} hash={hash} />
        ))}
      </div>

      <SectionLabel>Workspace management</SectionLabel>
      <div className="space-y-0.5 px-2">
        {managementItems.map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} hash={hash} />
        ))}
      </div>
    </nav>
  );
}
