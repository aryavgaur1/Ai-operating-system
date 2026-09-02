'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MessageSquare, Plug, ShieldCheck } from 'lucide-react';
import { api, type ApprovalRequest, type IntegrationStatus } from '@/lib/api';
import { APP_ROUTES, chatConversationPath, chatResumeHref } from '@/lib/routes';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { WorkPageHeader } from '@/components/work/WorkPageHeader';
import { WorkPanel } from '@/components/work/WorkPanel';
import { WorkAlert } from '@/components/work/WorkAlert';
import { WorkEmpty } from '@/components/work/WorkEmpty';
import { WorkLoading } from '@/components/work/WorkLoading';
import { cn } from '@/lib/utils';

type TimelineItem = {
  id: string;
  tool: string;
  action: string;
  status: string;
  title: string;
  outcome: string;
  url?: string;
  at?: string;
};

function formatWhen(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function OverviewPage() {
  const { current } = useWorkspaces();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [greetingName, setGreetingName] = useState('there');
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [recentChats, setRecentChats] = useState<Array<{ id: string; title: string; updated_at?: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [dash, tools, me] = await Promise.all([
          api.getDashboard(),
          api.listIntegrations(),
          api.me().catch(() => null),
        ]);
        if (cancelled) return;
        setGreetingName(me?.user?.displayName?.split(/\s+/)[0] || dash.workspaceName || 'there');
        setPending(dash.pendingApprovals || []);
        setTimeline(Array.isArray(dash.actionTimeline) ? dash.actionTimeline : []);
        setRecentChats(dash.recentConversations || []);
        setIntegrations(tools.tools || []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.organizationId]);

  const connected = integrations.filter((i) => i.status === 'active');
  const pendingCount = pending.length;

  return (
    <div className="space-y-6">
      <WorkPageHeader
        eyebrow="Workspace overview"
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}${greetingName !== 'there' ? `, ${greetingName}` : ''}`}
        description={`${current?.name ?? 'Your workspace'} · ${current?.kind === 'team' ? 'Team' : 'Personal'} workspace. Use Command to execute work; use the sections below to review and approve.`}
        meta={
          <Link href={chatResumeHref()} className="nx-btn-primary inline-flex items-center gap-2 px-4 py-2.5">
            <MessageSquare size={16} aria-hidden />
            Open command
          </Link>
        }
      />

      {error ? <WorkAlert variant="error">{error}</WorkAlert> : null}

      <WorkPanel title="Where to go">
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          <li>
            <span className="font-medium text-white">My Work</span>
            <p className="text-neutral-400">Your queue — pending approvals, blocked items, and recent actions.</p>
          </li>
          <li>
            <span className="font-medium text-white">Approvals</span>
            <p className="text-neutral-400">Review and approve actions before they run in connected systems.</p>
          </li>
          <li>
            <span className="font-medium text-white">Activity</span>
            <p className="text-neutral-400">Full audit log of what ran, when, and the outcome.</p>
          </li>
          <li>
            <span className="font-medium text-white">Connections</span>
            <p className="text-neutral-400">Connect Slack, Gmail, Notion, and Jira for this workspace.</p>
          </li>
        </ul>
      </WorkPanel>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Pending approvals', value: loading ? '—' : String(pendingCount), href: APP_ROUTES.approvals, icon: ShieldCheck },
          {
            label: 'Connected services',
            value: loading ? '—' : String(connected.length),
            href: APP_ROUTES.integrations,
            icon: Plug,
          },
          {
            label: 'Recent commands',
            value: loading ? '—' : String(recentChats.length),
            href: chatResumeHref(),
            icon: MessageSquare,
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="focus-ring nx-panel block p-4 transition hover:border-white/20"
            >
              <div className="flex items-center gap-2 text-neutral-500">
                <Icon size={14} />
                <span className="text-xs uppercase tracking-wide">{stat.label}</span>
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">{stat.value}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkPanel
          title="Requires your attention"
          action={
            pendingCount > 0 ? (
              <Link href={APP_ROUTES.approvals} className="focus-ring rounded-md text-xs text-accent hover:text-white">
                View all
              </Link>
            ) : null
          }
        >
          {loading ? (
            <WorkLoading />
          ) : pendingCount === 0 ? (
            <WorkEmpty>No actions waiting for approval.</WorkEmpty>
          ) : (
            <ul className="space-y-3">
              {pending.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium text-white">
                      {a.tool}.{a.action}
                    </div>
                    <div className="text-xs text-neutral-500">{a.riskLevel} risk</div>
                  </div>
                  <Link href={APP_ROUTES.approvals} className="shrink-0 text-xs text-accent">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WorkPanel>

        <WorkPanel title="Connected services">
          {loading ? (
            <WorkLoading />
          ) : (
            <ul className="space-y-2">
              {['slack', 'gmail', 'notion', 'jira'].map((tool) => {
                const row = integrations.find((i) => i.tool === tool);
                const live = row?.status === 'active';
                return (
                  <li key={tool} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-neutral-200">{tool}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        live ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-neutral-500'
                      )}
                    >
                      {live ? 'Connected' : 'Not connected'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href={APP_ROUTES.integrations}
            className="focus-ring mt-4 inline-flex items-center gap-1 text-xs text-accent hover:text-white"
          >
            Manage connections <ArrowRight size={12} aria-hidden />
          </Link>
        </WorkPanel>
      </div>

      <WorkPanel
        title="Recent activity"
        action={
          timeline.length > 0 ? (
            <Link href={APP_ROUTES.activity} className="focus-ring rounded-md text-xs text-accent hover:text-white">
              Full log
            </Link>
          ) : null
        }
      >
        {loading ? (
          <WorkLoading />
        ) : timeline.length === 0 ? (
          <WorkEmpty>No completed actions yet. Run a command from Command.</WorkEmpty>
        ) : (
          <ul className="space-y-3">
            {timeline.slice(0, 6).map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="text-neutral-200">
                    {item.tool}.{item.action}
                    <span className="ml-2 text-xs text-neutral-500">{item.status}</span>
                  </div>
                  {item.outcome ? <div className="text-xs text-neutral-500">{item.outcome}</div> : null}
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-500">
                  {formatWhen(item.at)}
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-accent">
                      Open
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </WorkPanel>

      {recentChats.length > 0 ? (
        <WorkPanel title="Recent commands">
          <ul className="space-y-2">
            {recentChats.map((c) => (
              <li key={c.id}>
                <Link
                  href={chatConversationPath(c.id)}
                  className="focus-ring flex items-center justify-between rounded-md px-2 py-2 text-sm text-neutral-300 hover:bg-white/5"
                >
                  <span className="truncate">{c.title || 'Conversation'}</span>
                  <span className="ml-3 shrink-0 text-xs text-neutral-500">{formatWhen(c.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </WorkPanel>
      ) : null}
    </div>
  );
}
