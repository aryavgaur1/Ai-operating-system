'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { itemsFromApprovals, itemsFromDashboard, mergeActivityItems } from '@/lib/workActivity';
import { formatDateTime } from '@/lib/approvalWork';
import { APP_ROUTES, chatResumeHref } from '@/lib/routes';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { WorkTable, WorkTableCell, WorkTableRow } from '@/components/work/WorkTable';

export default function ProjectsPage() {
  const { current } = useWorkspaces();
  const [loading, setLoading] = useState(true);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [jiraActivity, setJiraActivity] = useState<
    Array<{ id: string; title: string; status: string; outcome?: string; at: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tools, dash, approvalsRes] = await Promise.all([
          api.listIntegrations(),
          api.getDashboard(),
          api.listApprovals(),
        ]);
        if (cancelled) return;
        const jira = tools.tools?.find((t) => t.tool === 'jira');
        setJiraConnected(jira?.status === 'active');
        const items = mergeActivityItems(
          itemsFromDashboard(dash.actionTimeline, dash.activity),
          itemsFromApprovals(approvalsRes.approvals || [])
        ).filter((i) => i.tool === 'jira');
        setJiraActivity(
          items.map((i) => ({
            id: i.id,
            title: i.title,
            status: i.status,
            outcome: i.outcome,
            at: i.at,
          }))
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.organizationId]);

  const hasJiraWork = jiraActivity.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Workspace</p>
        <h1 className="font-display mt-2 text-2xl font-semibold text-white">Projects</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Nexora does not maintain a separate project registry. When Jira is connected, recent Jira work from this
          workspace appears below. Otherwise use Command to create tickets, war rooms, and Notion hubs.
        </p>
      </div>

      <div className="rounded-lg border border-white/10 px-4 py-3 text-sm text-neutral-400">
        <span className="text-neutral-200">Jira:</span>{' '}
        {jiraConnected ? 'Connected — issues are managed in your Jira site.' : 'Not connected.'}{' '}
        <Link href={APP_ROUTES.integrations} className="text-accent">
          {jiraConnected ? 'Manage integration' : 'Connect Jira'}
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : hasJiraWork ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-white">Recent Jira work</h2>
          <div className="rounded-lg border border-white/10">
            <WorkTable columns={['Action', 'Status', 'Result', 'When']}>
              {jiraActivity.map((row) => (
                <WorkTableRow key={row.id}>
                  <WorkTableCell className="text-white">{row.title}</WorkTableCell>
                  <WorkTableCell className="text-xs uppercase text-neutral-500">{row.status}</WorkTableCell>
                  <WorkTableCell className="max-w-xs truncate text-neutral-400">{row.outcome || '—'}</WorkTableCell>
                  <WorkTableCell className="text-neutral-500">{formatDateTime(row.at)}</WorkTableCell>
                </WorkTableRow>
              ))}
            </WorkTable>
          </div>
        </section>
      ) : (
        <div className="rounded-lg border border-white/10 px-4 py-6 text-sm text-neutral-400">
          <p>No Jira actions recorded in this workspace yet.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={chatResumeHref()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[#04101f]">
              Open command
            </Link>
            <Link
              href={APP_ROUTES.activity}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-200 hover:bg-white/5"
            >
              View all activity
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
