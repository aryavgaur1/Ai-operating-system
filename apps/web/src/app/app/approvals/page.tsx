'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileDiff,
  History,
  Loader2,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { api, type ApprovalRequest, type ToolCallResult } from '@/lib/api';
import { GlassCard, Reveal } from '@/components/motion';
import { RiskRadial } from '@/components/charts';
import { cn } from '@/lib/utils';
import { APP_ROUTES, chatConversationPath, chatResumeHref } from '@/lib/routes';
import { useRouter, useSearchParams } from 'next/navigation';

const riskScore: Record<string, number> = { low: 24, medium: 58, high: 88 };
const riskColor: Record<string, string> = { low: '#8be9d0', medium: '#f5b95d', high: '#fb7185' };
const riskCopy: Record<string, string> = {
  low: 'Reversible action with minimal blast radius. Safe for quick review.',
  medium: 'Touches shared systems or external-facing records. Worth a careful look.',
  high: 'Externally visible or hard to reverse. Review carefully before approving.',
};

const actionHint: Record<string, string> = {
  createIssue: 'Creates a real Jira issue',
  updateIssue: 'Mutates fields on a live issue',
  transitionIssue: 'Changes workflow status',
  deleteIssue: 'Deletes a live issue',
  addComment: 'Posts a public comment on Jira',
  linkIssues: 'Creates issue links',
  addAttachment: 'Uploads a file to Jira',
  sendEmail: 'Sends an external email',
  postMessage: 'Posts a Slack message',
  postMessageExternalChannel: 'Posts outside your workspace',
  createPage: 'Creates a Notion page',
  createPRD: 'Creates a Notion PRD',
  createMeetingNotes: 'Creates Notion meeting notes',
  createWiki: 'Creates a Notion wiki page',
  createRoadmap: 'Creates a Notion roadmap',
};

type TimelineState = 'verified' | 'failed' | 'rejected' | 'pending_execution' | 'expired';

function asOutput(result?: ToolCallResult | null): Record<string, unknown> {
  if (!result?.output || typeof result.output !== 'object') return {};
  return result.output as Record<string, unknown>;
}

function slackChannelLabel(raw: unknown, fallback?: unknown): string {
  const primary = String(raw || fallback || '').trim();
  if (!primary) return '#channel';
  if (primary.startsWith('#')) return primary;
  if (/^[CGD][A-Z0-9]+$/i.test(primary)) return primary;
  return `#${primary.replace(/^#/, '')}`;
}

function humanTitle(a: ApprovalRequest): string {
  const input = a.input || {};
  if (a.tool === 'jira' && a.action === 'createIssue') {
    return `Create Jira ticket: ${String(input.summary || input.title || 'Untitled')}`;
  }
  if (a.tool === 'jira' && a.action === 'addComment') {
    return `Comment on Jira ${String(input.issueKey || input.key || 'issue')}`;
  }
  if (a.tool === 'jira' && a.action === 'transitionIssue') {
    return `Move Jira ${String(input.issueKey || input.key || 'issue')} → ${String(input.status || input.transition || 'new status')}`;
  }
  if (a.tool === 'jira' && a.action === 'updateIssue') {
    return `Update Jira ${String(input.issueKey || input.key || 'issue')}`;
  }
  if (a.tool === 'slack' && (a.action === 'postMessage' || a.action === 'postMessageExternalChannel')) {
    return `Post to Slack ${slackChannelLabel(input.channel)}`;
  }
  if (a.tool === 'notion' && (a.action === 'createPage' || a.action.startsWith('create'))) {
    return `Create Notion page: ${String(input.title || 'Untitled')}`;
  }
  if (a.tool === 'notion') {
    return `Notion: ${String(input.title || a.action)}`;
  }
  if (a.tool === 'gmail' && a.action === 'sendEmail') {
    return `Email ${String(input.to || 'recipient')}: ${String(input.subject || 'draft')}`;
  }
  return `${a.tool}.${a.action}`;
}

/** Structured action plan for Approvals UX (user-safe; no chain-of-thought). */
function buildActionPlan(a: ApprovalRequest): {
  goal: string;
  understood: string;
  tool: string;
  action: string;
  target: string[];
  willChange: string[];
  risk: string;
  verification: string;
  status: string;
  steps: Array<{ id: string; label: string; kind: 'read' | 'write' | 'verify'; approval?: boolean }>;
} {
  const input = a.input || {};
  const goal =
    String(input._goal || '').trim() ||
    humanTitle(a);
  const understood =
    String(input._understood || '').trim() ||
    humanTitle(a);
  const target: string[] = [];
  const willChange: string[] = [];
  if (a.tool === 'jira' && a.action === 'createIssue') {
    if (input.project || input.projectKey) target.push(`Project: ${String(input.project || input.projectKey)}`);
    if (input.summary || input.title) target.push(`Title: ${String(input.summary || input.title)}`);
    if (input.issueType || input.type) target.push(`Type: ${String(input.issueType || input.type)}`);
    willChange.push('Create 1 Jira issue');
    if (input.description) willChange.push('Set issue description');
  } else if (a.tool === 'slack' && a.action.startsWith('postMessage')) {
    target.push(`Channel: ${slackChannelLabel(input.channel)}`);
    if (input.text) target.push(`Message: ${String(input.text).slice(0, 160)}`);
    willChange.push('Post 1 Slack message');
  } else if (a.tool === 'notion') {
    if (input.title) target.push(`Title: ${String(input.title)}`);
    if (input.pageId || input.id) target.push(`pageId: ${String(input.pageId || input.id)}`);
    willChange.push(a.action === 'updatePage' ? 'Update 1 Notion page' : 'Create 1 Notion page');
  } else {
    for (const [k, v] of Object.entries(input)) {
      if (k.startsWith('_')) continue;
      if (v == null || v === '') continue;
      target.push(`${k}: ${typeof v === 'string' ? v.slice(0, 120) : JSON.stringify(v).slice(0, 120)}`);
    }
    willChange.push(`Run ${a.tool}.${a.action}`);
  }

  let status = 'Waiting for approval';
  if (a.status === 'rejected') status = 'Rejected';
  else if (a.status === 'expired') status = 'Expired';
  else if (a.status === 'approved') {
    if (a.executionStatus === 'executing') status = 'Executing / verifying';
    else if (a.executionStatus === 'completed' && a.executionVerified) status = 'Completed (verified)';
    else if (a.executionStatus === 'failed') status = 'Failed';
    else if (a.executionStatus === 'completed') status = 'Completed';
    else status = 'Approved';
  }

  const verification =
    a.tool === 'jira'
      ? 'Jira issue will be retrieved after creation to verify the result.'
      : a.tool === 'slack'
        ? 'Slack message will be retrieved by channel + ts to verify the result.'
        : a.tool === 'notion'
          ? 'Notion page will be retrieved by exact pageId to verify the result.'
          : 'External object will be confirmed after execution.';

  return {
    goal,
    understood,
    tool: a.tool,
    action: `${a.tool}.${a.action}`,
    target,
    willChange,
    risk: a.riskLevel,
    verification,
    status,
    steps: [
      {
        id: 'step-1',
        label: humanTitle(a),
        kind: 'write',
        approval: true,
      },
      {
        id: 'step-2',
        label: 'Verify external result',
        kind: 'verify',
      },
    ],
  };
}

function timelineState(a: ApprovalRequest): TimelineState {
  if (a.status === 'rejected') return 'rejected';
  if (a.status === 'expired') return 'expired';
  if (a.status === 'approved') {
    const failed =
      a.executionStatus === 'failed' ||
      a.executionResult?.ok === false ||
      Boolean(a.executionResult?.error && !a.executionResult?.ok);
    if (failed) return 'failed';
    const verified =
      a.executionVerified === true ||
      a.executionStatus === 'completed' ||
      (a.executionResult?.ok === true && !a.executionResult?.mocked);
    if (verified) return 'verified';
    return 'pending_execution';
  }
  return 'pending_execution';
}

function timelineMeta(state: TimelineState): {
  label: string;
  tone: string;
  Icon: typeof CheckCircle2;
} {
  switch (state) {
    case 'verified':
      return {
        label: 'Approved · verified',
        tone: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
        Icon: CheckCircle2,
      };
    case 'failed':
      return {
        label: 'Approved · failed',
        tone: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
        Icon: ShieldAlert,
      };
    case 'rejected':
      return {
        label: 'Rejected',
        tone: 'border-rose-400/25 bg-rose-500/10 text-rose-300',
        Icon: XCircle,
      };
    case 'expired':
      return {
        label: 'Expired',
        tone: 'border-white/10 bg-white/5 text-neutral-400',
        Icon: Clock,
      };
    default:
      return {
        label: 'Pending execution',
        tone: 'border-sky-400/25 bg-sky-500/10 text-sky-200',
        Icon: Loader2,
      };
  }
}

/** Human-readable artifact from a verified execution (key, url, channel). */
function executionArtifacts(
  approval: Pick<ApprovalRequest, 'tool' | 'action' | 'input'>,
  result?: ToolCallResult | null
): { primary?: string; url?: string; detail?: string } {
  const o = asOutput(result);
  const input = approval.input || {};

  if (approval.tool === 'jira') {
    const key = String(o.key || o.issueKey || input.issueKey || input.key || '').trim();
    const url = typeof o.url === 'string' ? o.url : undefined;
    if (approval.action === 'createIssue' && key) {
      return { primary: key, url, detail: url ? `Opened in Jira` : 'Issue created in Jira' };
    }
    if (key) return { primary: key, url, detail: url ? 'View in Jira' : undefined };
  }

  if (approval.tool === 'notion') {
    const url = typeof o.url === 'string' ? o.url : undefined;
    const title = String(o.title || input.title || '').trim();
    const id = String(o.id || '').trim();
    if (url) {
      return {
        primary: title || 'Notion page',
        url,
        detail: 'Open in Notion',
      };
    }
    if (id) return { primary: title || id, detail: `Page id ${id.slice(0, 8)}…` };
  }

  if (approval.tool === 'slack') {
    const channel = slackChannelLabel(o.channelName || o.channel, input.channel);
    const ts = o.ts ? String(o.ts) : undefined;
    return {
      primary: channel,
      detail: ts ? `Posted · ts ${ts}` : 'Message posted',
    };
  }

  const key = o.key || o.id || o.ts;
  const url = typeof o.url === 'string' ? o.url : undefined;
  if (key || url) {
    return { primary: key ? String(key) : undefined, url, detail: url ? 'Open result' : undefined };
  }
  return {};
}

/** Flash / chat success copy after Approve & run. */
function successFlashMessage(approval: ApprovalRequest, result?: ToolCallResult | null): string {
  const arts = executionArtifacts(approval, result);
  const title = humanTitle(approval);

  if (approval.tool === 'jira' && approval.action === 'createIssue' && arts.primary) {
    return arts.url
      ? `Created Jira ${arts.primary} — ${arts.url}`
      : `Created Jira issue ${arts.primary}`;
  }
  if (approval.tool === 'jira' && arts.primary) {
    return arts.url
      ? `Jira ${arts.primary} updated — ${arts.url}`
      : `Jira ${arts.primary} updated`;
  }
  if (approval.tool === 'notion' && (approval.action === 'createPage' || approval.action.startsWith('create'))) {
    if (arts.url) {
      return arts.primary && arts.primary !== 'Notion page'
        ? `Created Notion page “${arts.primary}” — ${arts.url}`
        : `Created Notion page — ${arts.url}`;
    }
    return `Created Notion page${arts.primary ? `: ${arts.primary}` : ''}`;
  }
  if (
    approval.tool === 'slack' &&
    (approval.action === 'postMessage' || approval.action === 'postMessageExternalChannel')
  ) {
    return `Posted to Slack ${arts.primary || slackChannelLabel(approval.input?.channel)}`;
  }
  if (arts.primary && arts.url) return `Approved and ran: ${title} → ${arts.primary} — ${arts.url}`;
  if (arts.primary) return `Approved and ran: ${title} → ${arts.primary}`;
  return `Approved and executed ${approval.tool}.${approval.action} (verified).`;
}

function stepResultLabel(approval: ApprovalRequest, result?: ToolCallResult | null): string {
  const arts = executionArtifacts(approval, result);
  if (approval.tool === 'jira' && arts.primary) return `✓ ${arts.primary}`;
  if (approval.tool === 'notion' && arts.url) return `✓ page created`;
  if (approval.tool === 'notion' && arts.primary) return `✓ ${arts.primary}`;
  if (approval.tool === 'slack' && arts.primary) return `✓ ${arts.primary}`;
  if (arts.primary) return `✓ ${arts.primary}`;
  return '✓ verified';
}

function timelineSortTime(a: ApprovalRequest): number {
  const t = a.executedAt || a.createdAt;
  const n = t ? Date.parse(t) : 0;
  return Number.isFinite(n) ? n : 0;
}

function diffRows(input: Record<string, unknown>): Array<{ label: string; value: string }> {
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
    if (seen.has(key) || raw == null || raw === '') continue;
    if (typeof raw === 'object') continue;
    rows.push({ label: key, value: String(raw).slice(0, 280) });
    if (rows.length >= 10) break;
  }
  return rows;
}

function blastRadius(a: ApprovalRequest): string {
  if (a.tool === 'jira') return 'Visible to your Jira site members with access to that project/issue.';
  if (a.tool === 'slack') return 'Visible in the target Slack channel to everyone in that channel.';
  if (a.tool === 'notion') return 'Visible to people with access to the parent Notion page/workspace.';
  if (a.tool === 'gmail') return 'Leaves your mailbox and reaches the recipient outside Nexora.';
  return 'May change shared systems outside this chat.';
}

/** Fields a human can fix on the Approvals card before Approve & run. */
function editableFieldsFor(a: ApprovalRequest): Array<{ key: string; label: string; multiline?: boolean }> {
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

function draftValue(a: ApprovalRequest, drafts: Record<string, Record<string, string>>, key: string): string {
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

function buildInputPatch(a: ApprovalRequest, drafts: Record<string, Record<string, string>>): Record<string, unknown> | undefined {
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

export default function ApprovalsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-[28px] border border-white/10 bg-black/20 p-8 text-sm text-neutral-400">
          Loading approvals…
        </div>
      }
    >
      <ApprovalsPageInner />
    </Suspense>
  );
}

function ApprovalsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams?.get('focus') || '';
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<Record<string, string>>({});
  const [showRawId, setShowRawId] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'audit'>('pending');
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(focusId || null);

  function setDraftField(id: string, key: string, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [key]: value },
    }));
  }

  function load() {
    setLoading(true);
    api
      .listApprovals()
      .then((res) => setApprovals(res.approvals))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const pending = useMemo(() => approvals.filter((a) => a.status === 'pending'), [approvals]);
  const decided = useMemo(() => approvals.filter((a) => a.status !== 'pending'), [approvals]);
  const timeline = useMemo(
    () => [...decided].sort((a, b) => timelineSortTime(b) - timelineSortTime(a)),
    [decided]
  );
  const failedExec = useMemo(
    () => decided.filter((a) => timelineState(a) === 'failed'),
    [decided]
  );
  const highCount = pending.filter((a) => a.riskLevel === 'high').length;
  const timelineCounts = useMemo(() => {
    const counts = { verified: 0, failed: 0, rejected: 0, pending_execution: 0 };
    for (const a of decided) {
      const s = timelineState(a);
      if (s === 'verified') counts.verified += 1;
      else if (s === 'failed') counts.failed += 1;
      else if (s === 'rejected') counts.rejected += 1;
      else if (s === 'pending_execution') counts.pending_execution += 1;
    }
    return counts;
  }, [decided]);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (decidingId) return;
    setDecidingId(id);
    setError(null);
    try {
      const target = approvals.find((a) => a.id === id);
      const patch =
        decision === 'approved' && target ? buildInputPatch(target, drafts) : undefined;
      const res = await api.decideApproval(id, decision, patch);
      if (decision === 'approved') {
        const out = res.executionResult;
        if (out?.ok && !out.mocked) {
          setStepResults((prev) => ({
            ...prev,
            [id]: stepResultLabel(res.approval, out),
          }));
          const msg = successFlashMessage(res.approval, out);
          const remaining = pending.filter((p) => p.id !== id);
          if (remaining.length === 0) {
            const conv =
              res.approval.conversationId ||
              target?.conversationId ||
              '';
            router.push(conv ? chatConversationPath(conv) : chatResumeHref());
            return;
          }
          load();
          return;
        }
        load();
        if (out?.mocked) {
          setError(
            out.error ||
              'Mock result rejected — connect the live integration under Integrations, then retry Approve & run.'
          );
        } else if (out && !out.ok) {
          setStepResults((prev) => ({ ...prev, [id]: `✗ ${out.error || 'failed'}` }));
          setError(out.error || 'Approved, but execution failed. You can retry if safe.');
        } else {
          setError('Approved, but no verified execution result was returned.');
        }
        return;
      }
      load();
    } catch (err) {
      setError((err as Error).message);
      load();
    } finally {
      setDecidingId(null);
    }
  }

  async function approveAll() {
    if (decidingId || pending.length === 0) return;
    setError(null);
    const lines: string[] = [];
    for (const a of pending) {
      setDecidingId(a.id);
      try {
        const res = await api.decideApproval(a.id, 'approved');
        const out = res.executionResult;
        if (out?.ok && !out.mocked) {
          const flash = successFlashMessage(res.approval, out);
          lines.push(`✓ ${flash}`);
          setStepResults((prev) => ({ ...prev, [a.id]: stepResultLabel(res.approval, out) }));
        } else {
          lines.push(`✗ ${humanTitle(a)} → ${out?.error || 'failed'}`);
          setStepResults((prev) => ({ ...prev, [a.id]: `✗ ${out?.error || 'failed'}` }));
          setError(`Stopped after failure on ${humanTitle(a)}. Remaining steps not run.`);
          break;
        }
      } catch (err) {
        setError((err as Error).message);
        break;
      }
    }
    setDecidingId(null);
    load();
    if (lines.length && lines.every((l) => l.startsWith('✓'))) {
      const conv =
        pending.find((p) => p.conversationId)?.conversationId ||
        '';
      router.push(conv ? chatConversationPath(conv) : chatResumeHref());
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <Reveal>
        <GlassCard variant="glow" className="p-7" hoverLift={false}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <span className="badge border-white/10 bg-white/5 text-white">
                <ShieldCheck size={12} className="text-accent2" /> Work Action OS · human gate
              </span>
              <h1 className="font-display mt-4 text-3xl font-semibold text-white sm:text-4xl">Approvals</h1>
              <p className="mt-3 text-sm leading-7 text-neutral-400">
                This is the control room. Chat can propose actions in Jira, Slack, and Notion — nothing risky runs
                until you <strong className="font-medium text-neutral-200">Approve &amp; run</strong> or{' '}
                <strong className="font-medium text-neutral-200">Reject</strong>.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-neutral-400">
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1">1. Ask in Chat</span>
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1">2. Review here</span>
                <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-accent">
                  3. Approve → executes live
                </span>
              </div>
            </div>
            <div className="grid min-w-[220px] grid-cols-2 gap-3">
              <div className="rounded-[22px] border border-white/10 bg-black/25 px-4 py-4 text-center">
                <div className="text-3xl font-semibold text-white">{pending.length}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-neutral-500">pending</div>
              </div>
              <div className="rounded-[22px] border border-rose-400/20 bg-rose-500/10 px-4 py-4 text-center">
                <div className="text-3xl font-semibold text-rose-200">{highCount}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-rose-200/70">high risk</div>
              </div>
              <div className="col-span-2 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-xs text-neutral-400">
                <span className="inline-flex items-center gap-1.5 text-neutral-300">
                  <History size={12} /> Action Timeline
                </span>
                <div className="mt-1">
                  {decided.length} decided action{decided.length === 1 ? '' : 's'}
                  {timelineCounts.verified > 0 ? ` · ${timelineCounts.verified} verified` : ''}
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </Reveal>

      {error && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-semibold transition',
              tab === 'pending' ? 'bg-accent text-[#04101f]' : 'text-neutral-400 hover:text-white'
            )}
          >
            Pending ({pending.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-semibold transition',
              tab === 'audit' ? 'bg-accent text-[#04101f]' : 'text-neutral-400 hover:text-white'
            )}
          >
            Timeline ({decided.length})
          </button>
        </div>
        {tab === 'pending' && pending.length > 1 && (
          <button
            type="button"
            onClick={() => void approveAll()}
            disabled={decidingId !== null}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-[#04101f] disabled:opacity-50"
          >
            <CheckCircle2 size={14} /> Approve &amp; run all ({pending.length})
          </button>
        )}
      </div>

      {tab === 'pending' && (
        <div className="space-y-5">
          {pending.length === 0 && !loading && (
            <GlassCard className="p-6" hoverLift={false}>
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 text-accent2" size={18} />
                <div>
                  <div className="text-sm font-medium text-white">No pending approvals</div>
                  <p className="mt-2 text-sm leading-6 text-neutral-400">
                    Ask Chat for something that changes a tool. Risky actions pause here first.
                  </p>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-neutral-500">
                    <li>Create a Jira ticket to track the vendor contract follow-up</li>
                    <li>Draft an email to the client about the new timeline</li>
                    <li>Post to #ops on Slack: standup summary ready</li>
                  </ul>
                  <Link
                    href={chatResumeHref()}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white"
                  >
                    <MessageSquare size={13} /> Open Chat
                  </Link>
                </div>
              </div>
            </GlassCard>
          )}

          <div className="grid gap-5">
            <AnimatePresence>
              {pending.map((a, idx) => {
                const score = riskScore[a.riskLevel] ?? 40;
                const color = riskColor[a.riskLevel] ?? '#5b9dff';
                const hint = actionHint[a.action] || riskCopy[a.riskLevel] || riskCopy.high;
                const rows = diffRows(a.input ?? {});
                return (
                  <motion.div
                    key={a.id}
                    layout
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.25 } }}
                  >
                    <div className="glass rounded-[28px] p-6">
                      <div className="grid gap-6 lg:grid-cols-[1fr_180px]">
                        <div>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                                Step {idx + 1} of {pending.length}
                                {stepResults[a.id] ? ` · ${stepResults[a.id]}` : ''}
                              </div>
                              <div className="text-lg font-semibold text-white">{humanTitle(a)}</div>
                              <div className="mt-1 code text-xs text-neutral-500">
                                {a.tool}.{a.action}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                  <Clock size={11} />{' '}
                                  {a.createdAt ? new Date(a.createdAt).toLocaleString() : 'Just now'}
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                                  Pending review
                                </span>
                                {a.conversationId ? (
                                  <Link
                                    href={`${chatConversationPath(a.conversationId)}#approval-${a.id}`}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-accent hover:bg-accent/20"
                                  >
                                    <MessageSquare size={11} /> View conversation
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                            <span
                              className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                              style={{ borderColor: `${color}55`, color, background: `${color}18` }}
                            >
                              {a.riskLevel || 'high'} risk
                            </span>
                          </div>

                          {(() => {
                            const plan = buildActionPlan(a);
                            const open = expandedPlanId === a.id || focusId === a.id;
                            return (
                              <div
                                className={cn(
                                  'mt-4 rounded-2xl border p-4',
                                  focusId === a.id ? 'border-accent/40 bg-accent/5' : 'border-white/10 bg-black/30'
                                )}
                              >
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between text-left"
                                  onClick={() => setExpandedPlanId((id) => (id === a.id ? null : a.id))}
                                >
                                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
                                    Nexora action plan
                                  </span>
                                  <span className="text-[11px] text-neutral-500">{open ? 'Hide' : 'Show'}</span>
                                </button>
                                {open && (
                                  <div className="mt-3 space-y-3 text-sm text-neutral-300">
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Goal</div>
                                      <div className="mt-0.5 text-white">{plan.goal}</div>
                                    </div>
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Understood</div>
                                      <div className="mt-0.5">{plan.understood}</div>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div>
                                        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Tool</div>
                                        <div className="mt-0.5 capitalize">{plan.tool}</div>
                                      </div>
                                      <div>
                                        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Action</div>
                                        <div className="mt-0.5 code text-xs">{plan.action}</div>
                                      </div>
                                    </div>
                                    {plan.target.length > 0 && (
                                      <div>
                                        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Target</div>
                                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-neutral-200">
                                          {plan.target.map((t) => (
                                            <li key={t}>{t}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Will change</div>
                                      <ul className="mt-1 list-inside list-disc space-y-0.5">
                                        {plan.willChange.map((t) => (
                                          <li key={t}>{t}</li>
                                        ))}
                                      </ul>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div>
                                        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Risk</div>
                                        <div className="mt-0.5 capitalize">{plan.risk}</div>
                                      </div>
                                      <div>
                                        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Status</div>
                                        <div className="mt-0.5">{plan.status}</div>
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Verification</div>
                                      <div className="mt-0.5 text-neutral-400">{plan.verification}</div>
                                    </div>
                                    <div>
                                      <div className="text-[11px] uppercase tracking-wide text-neutral-500">Steps</div>
                                      <ol className="mt-1 space-y-1 text-xs text-neutral-400">
                                        {plan.steps.map((step, i) => (
                                          <li key={step.id}>
                                            {i + 1}. {step.label}{' '}
                                            <span className="uppercase text-neutral-600">
                                              ({step.kind}
                                              {step.approval ? ' · approval required' : ''})
                                            </span>
                                          </li>
                                        ))}
                                      </ol>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          <p className="mt-3 text-sm leading-6 text-neutral-400">{hint}</p>
                          <p className="mt-1 text-xs leading-5 text-neutral-500">
                            <Eye size={11} className="mr-1 inline" />
                            Blast radius: {blastRadius(a)}
                          </p>

                          <div className="mt-4">
                            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
                              <FileDiff size={12} /> What will change — edit before Approve &amp; run
                            </div>
                            {editableFieldsFor(a).length > 0 ? (
                              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4">
                                {editableFieldsFor(a).map((field) => (
                                  <label key={field.key} className="block">
                                    <span className="mb-1.5 block text-[11px] uppercase tracking-wide text-neutral-500">
                                      {field.label}
                                    </span>
                                    {field.multiline ? (
                                      <textarea
                                        value={draftValue(a, drafts, field.key)}
                                        onChange={(e) => setDraftField(a.id, field.key, e.target.value)}
                                        rows={4}
                                        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent/40"
                                      />
                                    ) : (
                                      <input
                                        value={draftValue(a, drafts, field.key)}
                                        onChange={(e) => setDraftField(a.id, field.key, e.target.value)}
                                        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent/40"
                                      />
                                    )}
                                  </label>
                                ))}
                                <p className="text-[11px] text-neutral-500">
                                  Edits save into this approval when you Approve &amp; run — no need to re-ask Chat.
                                </p>
                              </div>
                            ) : rows.length > 0 ? (
                              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                                {rows.map((row) => (
                                  <div
                                    key={row.label}
                                    className="grid grid-cols-[120px_1fr] gap-3 border-b border-white/5 px-4 py-2.5 text-xs last:border-b-0"
                                  >
                                    <span className="text-neutral-500">{row.label}</span>
                                    <span className="whitespace-pre-wrap break-words text-neutral-200">{row.value}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <pre className="code thin-scroll max-h-40 overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs leading-6 text-neutral-300">
                                {JSON.stringify(a.input ?? {}, null, 2)}
                              </pre>
                            )}
                            <button
                              type="button"
                              className="mt-2 text-[11px] text-neutral-500 hover:text-neutral-300"
                              onClick={() => setShowRawId((id) => (id === a.id ? null : a.id))}
                            >
                              {showRawId === a.id ? 'Hide raw JSON' : 'Show raw JSON'}
                            </button>
                            {showRawId === a.id && (
                              <pre className="code thin-scroll mt-2 max-h-40 overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs leading-6 text-neutral-300">
                                {JSON.stringify(
                                  {
                                    ...(a.input ?? {}),
                                    ...(buildInputPatch(a, drafts) || {}),
                                  },
                                  null,
                                  2
                                )}
                              </pre>
                            )}
                          </div>

                          <div className="mt-5 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => decide(a.id, 'approved')}
                              disabled={decidingId === a.id || decidingId !== null}
                              className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f] transition hover:bg-[#7db6ff] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <CheckCircle2 size={14} />{' '}
                              {decidingId === a.id ? 'Executing…' : 'Approve & run'}
                            </button>
                            <button
                              type="button"
                              onClick={() => decide(a.id, 'rejected')}
                              disabled={decidingId === a.id}
                              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-5 py-2.5 text-sm text-neutral-300 transition hover:text-white"
                            >
                              <XCircle size={14} /> Reject
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-center gap-2 rounded-[22px] border border-white/8 bg-black/20 p-4">
                          <div className="relative h-28 w-28">
                            <RiskRadial value={score} color={color} />
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-xl font-semibold text-white">{score}</span>
                              <span className="text-[10px] uppercase tracking-wide text-neutral-500">risk score</span>
                            </div>
                          </div>
                          <div className="text-center text-[10px] leading-4 text-neutral-500">{riskCopy[a.riskLevel]}</div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {failedExec.length > 0 && (
            <div>
              <div className="mb-4 text-xs uppercase tracking-[0.24em] text-amber-400/80">
                Failed executions ({failedExec.length})
              </div>
              <div className="space-y-2.5">
                {failedExec.map((a) => (
                  <div
                    key={`fail-${a.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-3.5 text-sm"
                  >
                    <div>
                      <div className="font-medium text-neutral-200">{humanTitle(a)}</div>
                      <div className="mt-1 text-[11px] text-amber-200/80">
                        {a.executionResult?.error ||
                          'Execution failed — fix connection/scopes, then re-ask in Chat to create a new approval'}
                      </div>
                    </div>
                    <Link
                      href={a.conversationId ? chatConversationPath(a.conversationId) : chatResumeHref()}
                      className="rounded-full border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-100"
                    >
                      Return to Chat
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-5">
          {decided.length === 0 && !loading && (
            <GlassCard className="p-6" hoverLift={false}>
              <div className="flex items-start gap-3">
                <History className="mt-0.5 text-accent2" size={18} />
                <div>
                  <div className="text-sm font-medium text-white">Action Timeline is empty</div>
                  <p className="mt-2 text-sm leading-6 text-neutral-400">
                    Every Approve &amp; run and Reject lands here as a durable memory of what actually happened —
                    keys, URLs, and failure reasons included.
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          {decided.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-neutral-300">
                  <History size={11} /> Action Timeline · newest first
                </span>
                {timelineCounts.verified > 0 && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                    {timelineCounts.verified} verified
                  </span>
                )}
                {timelineCounts.failed > 0 && (
                  <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-amber-200">
                    {timelineCounts.failed} failed
                  </span>
                )}
                {timelineCounts.rejected > 0 && (
                  <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-rose-300">
                    {timelineCounts.rejected} rejected
                  </span>
                )}
                {timelineCounts.pending_execution > 0 && (
                  <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-sky-200">
                    {timelineCounts.pending_execution} pending execution
                  </span>
                )}
              </div>

              <div className="relative space-y-0 pl-2">
                <div
                  className="pointer-events-none absolute bottom-3 left-[21px] top-3 w-px bg-gradient-to-b from-white/20 via-white/10 to-transparent"
                  aria-hidden
                />
                {timeline.map((a, idx) => {
                  const state = timelineState(a);
                  const meta = timelineMeta(state);
                  const Icon = meta.Icon;
                  const arts = executionArtifacts(a, a.executionResult);
                  const when = a.executedAt || a.createdAt;
                  const errorText =
                    state === 'failed'
                      ? a.executionResult?.error ||
                        'Execution failed — fix connection/scopes, then re-ask in Chat to create a new approval'
                      : null;

                  return (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(idx * 0.04, 0.32) }}
                      className="relative flex gap-4 pb-5 last:pb-0"
                    >
                      <div className="relative z-[1] flex w-8 shrink-0 justify-center pt-4">
                        <span
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] shadow-[0_0_0_4px_rgba(4,10,20,0.9)]',
                            meta.tone
                          )}
                        >
                          <Icon size={14} className={state === 'pending_execution' ? 'animate-spin' : undefined} />
                        </span>
                      </div>

                      <div className="glass min-w-0 flex-1 rounded-[22px] p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-base font-semibold text-white">{humanTitle(a)}</div>
                            <div className="mt-1 code text-[11px] text-neutral-500">
                              {a.tool}.{a.action}
                            </div>
                            {a.conversationId ? (
                              <Link
                                href={`${chatConversationPath(a.conversationId)}#approval-${a.id}`}
                                className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:text-white"
                              >
                                <MessageSquare size={12} /> View conversation
                              </Link>
                            ) : null}
                          </div>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
                              meta.tone
                            )}
                          >
                            {meta.label}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-neutral-500">
                          {when && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-2.5 py-1">
                              <Clock size={11} />
                              {a.executedAt ? 'Executed' : 'Decided'} {new Date(when).toLocaleString()}
                            </span>
                          )}
                          {a.createdAt && a.executedAt && (
                            <span className="rounded-full border border-white/8 bg-black/20 px-2.5 py-1">
                              Requested {new Date(a.createdAt).toLocaleString()}
                            </span>
                          )}
                          {a.riskLevel && (
                            <span
                              className="rounded-full border px-2.5 py-1 capitalize"
                              style={{
                                borderColor: `${riskColor[a.riskLevel] ?? '#5b9dff'}44`,
                                color: riskColor[a.riskLevel] ?? '#5b9dff',
                                background: `${riskColor[a.riskLevel] ?? '#5b9dff'}14`,
                              }}
                            >
                              {a.riskLevel} risk
                            </span>
                          )}
                        </div>

                        {state === 'verified' && (arts.primary || arts.url) && (
                          <div className="mt-4 rounded-2xl border border-emerald-400/15 bg-emerald-500/5 px-4 py-3">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-400/70">Result</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                              {arts.primary && (
                                <span className="text-sm font-medium text-emerald-100">{arts.primary}</span>
                              )}
                              {arts.detail && !arts.url && (
                                <span className="text-xs text-emerald-200/60">{arts.detail}</span>
                              )}
                              {arts.url && (
                                <a
                                  href={arts.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                                >
                                  {arts.detail || 'Open'} <ExternalLink size={11} />
                                </a>
                              )}
                            </div>
                            {arts.url && (
                              <div className="mt-1 truncate text-[11px] text-neutral-500">{arts.url}</div>
                            )}
                          </div>
                        )}

                        {state === 'failed' && errorText && (
                          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/5 px-4 py-3">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80">
                              Execution error
                            </div>
                            <p className="mt-1.5 text-sm leading-6 text-amber-100/90">{errorText}</p>
                            <Link
                              href={a.conversationId ? chatConversationPath(a.conversationId) : chatResumeHref()}
                              className="mt-3 inline-flex rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100"
                            >
                              Return to Chat to retry
                            </Link>
                          </div>
                        )}

                        {state === 'rejected' && (
                          <p className="mt-4 text-xs leading-5 text-neutral-500">
                            This action was blocked and never executed against the live tool.
                          </p>
                        )}

                        {state === 'pending_execution' && (
                          <p className="mt-4 text-xs leading-5 text-sky-200/70">
                            Approved, but a verified execution result has not landed yet. Refresh shortly or check
                            Integrations if this stalls.
                          </p>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <Link href={chatResumeHref()} className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white">
        <ArrowLeft size={12} /> Back to chat
      </Link>
    </div>
  );
}
