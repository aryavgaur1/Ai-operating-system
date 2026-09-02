'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/approvalWork';
import {
  filterActivity,
  itemsFromApprovals,
  itemsFromDashboard,
  mergeActivityItems,
  type ActivityFilter,
  type WorkActivityItem,
} from '@/lib/workActivity';
import { APP_ROUTES, chatResumeHref } from '@/lib/routes';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { WorkPageHeader } from '@/components/work/WorkPageHeader';
import { WorkPanel } from '@/components/work/WorkPanel';
import { WorkAlert } from '@/components/work/WorkAlert';
import { WorkEmpty } from '@/components/work/WorkEmpty';
import { WorkLoading } from '@/components/work/WorkLoading';
import { WorkTable, WorkTableCell, WorkTableRow } from '@/components/work/WorkTable';
import { cn } from '@/lib/utils';

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'slack', label: 'Slack' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'notion', label: 'Notion' },
  { id: 'jira', label: 'Jira' },
];

export default function ActivityPage() {
  const { current } = useWorkspaces();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WorkActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [dash, approvalsRes] = await Promise.all([api.getDashboard(), api.listApprovals()]);
        if (cancelled) return;
        const merged = mergeActivityItems(
          itemsFromDashboard(dash.actionTimeline, dash.activity),
          itemsFromApprovals(approvalsRes.approvals || [])
        );
        setItems(merged);
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

  const filtered = useMemo(() => filterActivity(items, filter), [items, filter]);

  return (
    <div className="space-y-6">
      <WorkPageHeader
        title="Activity"
        description={`Chronological actions in ${current?.name ?? 'this workspace'}.`}
      />

      {error ? <WorkAlert variant="error">{error}</WorkAlert> : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'focus-ring rounded-md border px-3 py-1.5 text-xs font-medium transition',
              filter === f.id
                ? 'border-white/20 bg-white/10 text-white'
                : 'border-white/10 text-neutral-500 hover:text-neutral-300'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <WorkPanel flush>
        {loading ? (
          <WorkLoading />
        ) : filtered.length === 0 ? (
          <WorkEmpty>
            No activity for this filter.{' '}
            <Link href={chatResumeHref()} className="text-accent">
              Run a command
            </Link>
            .
          </WorkEmpty>
        ) : (
          <WorkTable columns={['Time', 'Action', 'Service', 'Status', '']} caption="Activity log">
            {filtered.map((item) => {
              const failed = item.status === 'failed' || item.status === 'rejected';
              const open = expandedId === item.id;
              return (
                <Fragment key={item.id}>
                  <WorkTableRow onClick={() => setExpandedId(open ? null : item.id)}>
                    <WorkTableCell className="w-20 text-neutral-500">{formatTime(item.at)}</WorkTableCell>
                    <WorkTableCell className="font-medium text-white">{item.title}</WorkTableCell>
                    <WorkTableCell>{item.service}</WorkTableCell>
                    <WorkTableCell>
                      <span
                        className={cn(
                          'text-xs uppercase',
                          failed ? 'text-rose-300' : item.status === 'done' ? 'text-emerald-300' : 'text-neutral-500'
                        )}
                      >
                        {item.status}
                      </span>
                    </WorkTableCell>
                    <WorkTableCell className="text-right text-xs text-neutral-500">{open ? '▲' : '▼'}</WorkTableCell>
                  </WorkTableRow>
                  {open ? (
                    <tr>
                      <td colSpan={5} className="border-t border-white/5 bg-black/20 px-4 py-3 text-sm">
                        <dl className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <dt className="text-[10px] uppercase text-neutral-500">Action</dt>
                            <dd className="text-neutral-200">
                              {item.tool}.{item.action}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[10px] uppercase text-neutral-500">When</dt>
                            <dd className="text-neutral-400">{formatDateTime(item.at)}</dd>
                          </div>
                          {item.outcome ? (
                            <div className="sm:col-span-2">
                              <dt className="text-[10px] uppercase text-neutral-500">
                                {failed ? 'Reason' : 'Result'}
                              </dt>
                              <dd className={cn(failed ? 'text-rose-200' : 'text-neutral-300')}>{item.outcome}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="focus-ring nx-btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs text-accent"
                            >
                              Open resource
                              <ExternalLink size={12} />
                            </a>
                          ) : null}
                          <Link
                            href={APP_ROUTES.approvals}
                            className="focus-ring nx-btn-secondary px-3 py-1.5 text-xs text-neutral-400"
                          >
                            Approvals
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </WorkTable>
        )}
      </WorkPanel>
    </div>
  );
}
