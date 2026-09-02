import type { ApprovalRequest } from '@/lib/api';
import { humanActionTitle, serviceLabel, timelineActionTitle } from '@/lib/actionPlan';

export type ActivityFilter = 'all' | 'slack' | 'gmail' | 'notion' | 'jira';

export type WorkActivityItem = {
  id: string;
  tool: string;
  action: string;
  title: string;
  service: string;
  status: string;
  outcome?: string;
  url?: string;
  at: string;
  source: 'execution' | 'audit';
};

type TimelineRow = {
  id: string;
  tool: string;
  action: string;
  status: string;
  title?: string;
  outcome?: string;
  url?: string;
  at?: string;
};

type AuditRow = {
  id: string;
  event_type?: string;
  tool?: string;
  detail?: string;
  created_at?: string;
};

export function itemsFromDashboard(
  timeline: TimelineRow[] = [],
  audit: AuditRow[] = []
): WorkActivityItem[] {
  const fromTimeline: WorkActivityItem[] = timeline.map((row) => ({
    id: row.id,
    tool: row.tool,
    action: row.action,
    title: timelineActionTitle(row.tool, row.action),
    service: serviceLabel(row.tool),
    status: row.status,
    outcome: row.outcome,
    url: row.url,
    at: row.at || '',
    source: 'execution',
  }));

  const fromAudit: WorkActivityItem[] = audit.map((row) => ({
    id: `audit-${row.id}`,
    tool: row.tool || 'system',
    action: row.event_type || 'event',
    title: row.event_type || 'Audit event',
    service: row.tool ? serviceLabel(row.tool) : 'System',
    status: 'logged',
    outcome: row.detail ? String(row.detail).slice(0, 200) : undefined,
    at: row.created_at || '',
    source: 'audit',
  }));

  return [...fromTimeline, ...fromAudit].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function itemsFromApprovals(approvals: ApprovalRequest[]): WorkActivityItem[] {
  return approvals
    .filter((a) => a.status !== 'pending')
    .map((a) => {
      const failed =
        a.status === 'approved' &&
        (a.executionStatus === 'failed' || a.executionResult?.ok === false);
      const out = a.executionResult?.output as Record<string, unknown> | undefined;
      const url = typeof out?.url === 'string' ? out.url : undefined;
      const key = out?.key || out?.id || out?.ts;
      return {
        id: a.id,
        tool: a.tool,
        action: a.action,
        title: humanActionTitle(a.tool, a.action, a.input || {}),
        service: serviceLabel(a.tool),
        status:
          a.status === 'rejected' ? 'rejected' : failed ? 'failed' : a.status === 'approved' ? 'done' : a.status,
        outcome: a.executionResult?.error
          ? String(a.executionResult.error)
          : key
            ? String(key)
            : a.status,
        url,
        at: a.executedAt || a.createdAt,
        source: 'execution' as const,
      };
    });
}

export function mergeActivityItems(...groups: WorkActivityItem[][]): WorkActivityItem[] {
  const seen = new Set<string>();
  const merged: WorkActivityItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function filterActivity(items: WorkActivityItem[], filter: ActivityFilter): WorkActivityItem[] {
  if (filter === 'all') return items;
  return items.filter((i) => i.tool === filter);
}
