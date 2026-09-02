import type { ApprovalRequest } from '@/lib/api';
import { buildActionPreviewFromApproval, humanActionTitle } from '@/lib/actionPlan';

export function approvalActionTitle(a: ApprovalRequest): string {
  return humanActionTitle(a.tool, a.action, a.input || {});
}

export function approvalTargetSummary(a: ApprovalRequest): string {
  const preview = buildActionPreviewFromApproval(a, '');
  const input = a.input || {};
  if (a.tool === 'jira' && (input.project || input.projectKey)) {
    return String(input.project || input.projectKey);
  }
  if (a.tool === 'slack' && (input.channel || input.name || input.project)) {
    return String(input.channel || input.name || input.project);
  }
  if (a.tool === 'notion' && input.title) return String(input.title);
  if (a.tool === 'gmail' && input.to) return String(input.to);
  if (preview.willChange[0]) return preview.willChange[0];
  return `${a.tool}.${a.action}`;
}

export function approvalWillChange(a: ApprovalRequest): string[] {
  return buildActionPreviewFromApproval(a, '').willChange;
}

export function blastRadius(a: ApprovalRequest): string {
  if (a.tool === 'jira') return 'Visible to Jira site members with project/issue access.';
  if (a.tool === 'slack') return 'Visible in the target Slack channel.';
  if (a.tool === 'notion') return 'Visible to people with Notion workspace/page access.';
  if (a.tool === 'gmail') return 'Leaves your mailbox and reaches the recipient.';
  return 'May change shared external systems.';
}

export function diffRows(input: Record<string, unknown>): Array<{ label: string; value: string }> {
  const preferred = [
    'summary',
    'title',
    'project',
    'projectKey',
    'issueKey',
    'key',
    'status',
    'transition',
    'channel',
    'text',
    'to',
    'subject',
    'body',
    'comment',
    'parentPageId',
    'issueType',
    'type',
  ];
  const rows: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const key of preferred) {
    if (input[key] == null || input[key] === '') continue;
    seen.add(key);
    const raw = input[key];
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    rows.push({ label: key, value: value.length > 280 ? `${value.slice(0, 280)}…` : value });
  }
  for (const [key, raw] of Object.entries(input)) {
    if (seen.has(key) || key.startsWith('_') || raw == null || raw === '') continue;
    if (typeof raw === 'object') continue;
    rows.push({ label: key, value: String(raw).slice(0, 280) });
    if (rows.length >= 10) break;
  }
  return rows;
}

export function editableFieldsFor(
  a: ApprovalRequest
): Array<{ key: string; label: string; multiline?: boolean }> {
  if (a.tool === 'jira' && a.action === 'createIssue') {
    return [
      { key: 'project', label: 'Project key' },
      { key: 'summary', label: 'Summary / title' },
      { key: 'description', label: 'Description', multiline: true },
      { key: 'issueType', label: 'Issue type' },
    ];
  }
  if (a.tool === 'jira') {
    return [
      { key: 'issueKey', label: 'Issue key' },
      { key: 'comment', label: 'Comment', multiline: true },
      { key: 'status', label: 'Status / transition' },
    ];
  }
  if (a.tool === 'notion') {
    return [
      { key: 'title', label: 'Page title' },
      { key: 'parentPageId', label: 'Parent page id (optional)' },
    ];
  }
  if (a.tool === 'slack' && (a.action === 'postMessage' || a.action === 'postMessageExternalChannel')) {
    return [
      { key: 'channel', label: 'Channel' },
      { key: 'text', label: 'Message', multiline: true },
    ];
  }
  if (a.tool === 'gmail' && a.action === 'sendEmail') {
    return [
      { key: 'to', label: 'To' },
      { key: 'subject', label: 'Subject' },
      { key: 'body', label: 'Body', multiline: true },
    ];
  }
  return [];
}

export function draftValue(
  a: ApprovalRequest,
  drafts: Record<string, Record<string, string>>,
  key: string
): string {
  const d = drafts[a.id];
  if (d && key in d) return d[key];
  const input = a.input || {};
  if (key === 'project') return String(input.project ?? input.projectKey ?? '');
  if (key === 'issueType') return String(input.issueType ?? input.type ?? '');
  if (key === 'issueKey') return String(input.issueKey ?? input.key ?? '');
  if (key === 'status') return String(input.status ?? input.transition ?? '');
  const raw = input[key];
  if (raw == null) return '';
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

export function buildInputPatch(
  a: ApprovalRequest,
  drafts: Record<string, Record<string, string>>
): Record<string, unknown> | undefined {
  const fields = editableFieldsFor(a);
  if (!fields.length) return undefined;
  const patch: Record<string, unknown> = {};
  let dirty = false;
  for (const f of fields) {
    const next = draftValue(a, drafts, f.key).trim();
    const prev =
      f.key === 'project'
        ? String(a.input?.project ?? a.input?.projectKey ?? '').trim()
        : f.key === 'issueType'
          ? String(a.input?.issueType ?? a.input?.type ?? '').trim()
          : f.key === 'issueKey'
            ? String(a.input?.issueKey ?? a.input?.key ?? '').trim()
            : f.key === 'status'
              ? String(a.input?.status ?? a.input?.transition ?? '').trim()
              : String(a.input?.[f.key] ?? '').trim();
    if (next !== prev) dirty = true;
    if (f.key === 'project') {
      patch.project = next.toUpperCase();
      patch.projectKey = next.toUpperCase();
    } else if (f.key === 'issueType') {
      patch.issueType = next;
      patch.type = next;
    } else if (f.key === 'issueKey') {
      patch.issueKey = next;
      patch.key = next;
    } else if (f.key === 'status') {
      patch.status = next;
      patch.transition = next;
    } else {
      patch[f.key] = next;
    }
  }
  return dirty ? patch : undefined;
}

export function formatDateTime(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function formatTime(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}
