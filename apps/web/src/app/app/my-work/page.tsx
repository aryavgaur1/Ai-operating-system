'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, type ApprovalRequest } from '@/lib/api';
import {
  approvalActionTitle,
  approvalTargetSummary,
  formatDateTime,
} from '@/lib/approvalWork';
import { serviceLabel } from '@/lib/actionPlan';
import {
  itemsFromApprovals,
  itemsFromDashboard,
  mergeActivityItems,
} from '@/lib/workActivity';
import { APP_ROUTES, chatConversationPath, chatResumeHref } from '@/lib/routes';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { WorkPageHeader } from '@/components/work/WorkPageHeader';
import { WorkPanel } from '@/components/work/WorkPanel';
import { WorkAlert } from '@/components/work/WorkAlert';
import { WorkEmpty } from '@/components/work/WorkEmpty';
import { WorkLoading } from '@/components/work/WorkLoading';
import { WorkTable, WorkTableCell, WorkTableRow } from '@/components/work/WorkTable';
import { cn } from '@/lib/utils';

export default function MyWorkPage() {
  const { current } = useWorkspaces();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [failed, setFailed] = useState<ApprovalRequest[]>([]);
  const [recentActions, setRecentActions] = useState<ReturnType<typeof itemsFromDashboard>>([]);
  const [recentChats, setRecentChats] = useState<Array<{ id: string; title: string; updated_at?: string }>>([]);
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [approvalsRes, dash, tools] = await Promise.all([
          api.listApprovals(),
          api.getDashboard(),
          api.listIntegrations(),
        ]);
        if (cancelled) return;
        const all = approvalsRes.approvals || [];
        setPending(all.filter((a) => a.status === 'pending'));
        setFailed(
          all.filter(
            (a) =>
              a.status === 'approved' &&
              (a.executionStatus === 'failed' || a.executionResult?.ok === false)
          )
        );
        const dashItems = itemsFromDashboard(dash.actionTimeline, dash.activity);
        const approvalItems = itemsFromApprovals(all);
        setRecentActions(mergeActivityItems(dashItems, approvalItems).slice(0, 12));
        setRecentChats(dash.recentConversations || []);
        const map: Record<string, boolean> = {};
        for (const t of tools.tools || []) {
          map[t.tool] = t.status === 'active';
        }
        setIntegrations(map);
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

  const stats = useMemo(
    () => ({
      pending: pending.length,
      blocked: failed.length,
      recent: recentActions.length,
    }),
    [pending.length, failed.length, recentActions.length]
  );

  return (
    <div className="space-y-8">
      <WorkPageHeader
        title="My Work"
        description="Your queue in this workspace — items waiting for approval, blocked work, and recent activity."
      />

      {error ? <WorkAlert variant="error">{error}</WorkAlert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Pending approvals', value: stats.pending, href: APP_ROUTES.approvals },
          { label: 'Blocked / failed', value: stats.blocked, href: APP_ROUTES.activity },
          { label: 'Recent actions', value: stats.recent, href: APP_ROUTES.activity },
        ].map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="focus-ring nx-panel block px-4 py-3 transition hover:border-white/20"
          >
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold text-white">{loading ? '—' : s.value}</div>
          </Link>
        ))}
      </div>

      <WorkPanel
        title="Needs your attention"
        flush
        action={
          <Link href={APP_ROUTES.approvals} className="focus-ring rounded-md text-xs text-accent">
            Approval center
          </Link>
        }
      >
          {loading ? (
            <WorkLoading />
          ) : pending.length === 0 ? (
            <WorkEmpty>No pending approvals.</WorkEmpty>
          ) : (
            <WorkTable columns={['Action', 'Service', 'Target', 'Created', '']} caption="Pending approvals">
              {pending.map((a) => (
                <WorkTableRow key={a.id}>
                  <WorkTableCell className="font-medium text-white">{approvalActionTitle(a)}</WorkTableCell>
                  <WorkTableCell>{serviceLabel(a.tool)}</WorkTableCell>
                  <WorkTableCell className="max-w-[200px] truncate">{approvalTargetSummary(a)}</WorkTableCell>
                  <WorkTableCell className="text-neutral-500">{formatDateTime(a.createdAt)}</WorkTableCell>
                  <WorkTableCell className="text-right">
                    <Link href={`${APP_ROUTES.approvals}?focus=${encodeURIComponent(a.id)}`} className="text-xs text-accent">
                      Review
                    </Link>
                  </WorkTableCell>
                </WorkTableRow>
              ))}
            </WorkTable>
          )}
      </WorkPanel>

      {failed.length > 0 ? (
        <WorkPanel
          title="Blocked work"
          flush
          action={
            <Link href={APP_ROUTES.activity} className="focus-ring rounded-md text-xs text-accent">
              View activity
            </Link>
          }
          className="border-rose-500/20"
        >
            <WorkTable columns={['Action', 'Service', 'Reason', 'When', '']} caption="Blocked work">
              {failed.map((a) => (
                <WorkTableRow key={a.id}>
                  <WorkTableCell className="text-white">{approvalActionTitle(a)}</WorkTableCell>
                  <WorkTableCell>{serviceLabel(a.tool)}</WorkTableCell>
                  <WorkTableCell className="max-w-xs truncate text-rose-200">
                    {a.executionResult?.error || 'Execution failed'}
                  </WorkTableCell>
                  <WorkTableCell className="text-neutral-500">{formatDateTime(a.executedAt || a.createdAt)}</WorkTableCell>
                  <WorkTableCell className="text-right">
                    <Link href={`${APP_ROUTES.approvals}?focus=${encodeURIComponent(a.id)}`} className="text-xs text-accent">
                      Details
                    </Link>
                  </WorkTableCell>
                </WorkTableRow>
              ))}
            </WorkTable>
        </WorkPanel>
      ) : null}

      <WorkPanel
        title="Recent actions"
        flush
        action={
          <Link href={APP_ROUTES.activity} className="focus-ring rounded-md text-xs text-accent">
            Full log
          </Link>
        }
      >
          {loading ? (
            <WorkLoading />
          ) : recentActions.length === 0 ? (
            <WorkEmpty>No completed actions yet.</WorkEmpty>
          ) : (
            <WorkTable columns={['Time', 'Action', 'Service', 'Status']} caption="Recent actions">
              {recentActions.slice(0, 8).map((item) => (
                <WorkTableRow key={item.id}>
                  <WorkTableCell className="w-20 text-neutral-500">{formatDateTime(item.at).split(',')[1]?.trim() || formatDateTime(item.at)}</WorkTableCell>
                  <WorkTableCell className="text-white">{item.title}</WorkTableCell>
                  <WorkTableCell>{item.service}</WorkTableCell>
                  <WorkTableCell>
                    <span
                      className={cn(
                        'text-xs uppercase',
                        item.status === 'failed' ? 'text-rose-300' : 'text-neutral-500'
                      )}
                    >
                      {item.status}
                    </span>
                  </WorkTableCell>
                </WorkTableRow>
              ))}
            </WorkTable>
          )}
      </WorkPanel>

      <WorkPanel
        title="Recent commands"
        action={
          <Link href={chatResumeHref()} className="focus-ring rounded-md text-xs text-accent">
            Open command
          </Link>
        }
      >
          {loading ? (
            <WorkLoading />
          ) : recentChats.length === 0 ? (
            <WorkEmpty>No conversations yet.</WorkEmpty>
          ) : (
            <ul className="divide-y divide-white/5">
              {recentChats.map((c) => (
                <li key={c.id}>
                  <Link
                    href={chatConversationPath(c.id)}
                    className="focus-ring flex items-center justify-between px-4 py-3 text-sm hover:bg-white/[0.03]"
                  >
                    <span className="truncate text-neutral-200">{c.title || 'Conversation'}</span>
                    <span className="ml-3 shrink-0 text-xs text-neutral-500">
                      {c.updated_at ? formatDateTime(c.updated_at) : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </WorkPanel>

      <WorkPanel title="External task feeds">
        <p className="text-sm leading-6 text-neutral-400">
          {integrations.jira
            ? 'Jira is connected — use Command to search assigned issues or create tickets.'
            : 'Jira is not connected — connect under Integrations to work with issues.'}{' '}
          {integrations.gmail
            ? 'Gmail is connected — use Command to find priority or unread email.'
            : 'Gmail is not connected.'}
        </p>
        <Link href={APP_ROUTES.integrations} className="focus-ring mt-2 inline-block text-xs text-accent">
          Manage connections
        </Link>
      </WorkPanel>
    </div>
  );
}
