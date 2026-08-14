'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  FileDiff,
  History,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { api, type ApprovalRequest } from '@/lib/api';
import { GlassCard, Reveal } from '@/components/motion';
import { RiskRadial } from '@/components/charts';
import { cn } from '@/lib/utils';

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
  if (a.tool === 'slack' && (a.action === 'postMessage' || a.action === 'postMessageExternalChannel')) {
    const ch = String(input.channel || 'channel');
    return `Post to Slack ${ch.startsWith('#') ? ch : `#${ch}`}`;
  }
  if (a.tool === 'notion') {
    return `Notion: ${String(input.title || a.action)}`;
  }
  if (a.tool === 'gmail' && a.action === 'sendEmail') {
    return `Email ${String(input.to || 'recipient')}: ${String(input.subject || 'draft')}`;
  }
  return `${a.tool}.${a.action}`;
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

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<Record<string, string>>({});
  const [showRawId, setShowRawId] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'audit'>('pending');

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
  const failedExec = useMemo(
    () =>
      decided.filter(
        (a) => a.status === 'approved' && (a.executionStatus === 'failed' || a.executionResult?.ok === false)
      ),
    [decided]
  );
  const highCount = pending.filter((a) => a.riskLevel === 'high').length;

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (decidingId) return;
    setDecidingId(id);
    setError(null);
    try {
      const res = await api.decideApproval(id, decision);
      if (decision === 'approved') {
        const out = res.executionResult;
        if (out?.ok && !out.mocked) {
          const o = (out.output || {}) as Record<string, unknown>;
          const key = o.key || o.id || o.ts;
          setStepResults((prev) => ({
            ...prev,
            [id]: key ? `✓ ${String(key)}` : '✓ verified',
          }));
          const url = o.url;
          const msg = key
            ? `Approved and created ${key}${url ? ` — ${url}` : ''}`
            : `Approved and executed ${res.approval.tool}.${res.approval.action} (verified).`;
          const remaining = pending.filter((p) => p.id !== id);
          if (remaining.length === 0) {
            window.sessionStorage.setItem('nexora:approvalFlash', msg);
            window.location.href = '/app/chat';
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
          const key = (out.output as any)?.key || (out.output as any)?.id || 'ok';
          lines.push(`✓ ${a.tool}.${a.action} → ${key}`);
          setStepResults((prev) => ({ ...prev, [a.id]: `✓ ${key}` }));
        } else {
          lines.push(`✗ ${a.tool}.${a.action} → ${out?.error || 'failed'}`);
          setStepResults((prev) => ({ ...prev, [a.id]: `✗ ${out?.error || 'failed'}` }));
          setError(`Stopped after failure on ${a.tool}.${a.action}. Remaining steps not run.`);
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
      window.sessionStorage.setItem('nexora:approvalFlash', lines.join('\n'));
      window.location.href = '/app/chat';
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
                  <History size={12} /> Audit trail
                </span>
                <div className="mt-1">{decided.length} decided action{decided.length === 1 ? '' : 's'} logged</div>
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
            Audit ({decided.length})
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
                    href="/app/chat"
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
                              </div>
                            </div>
                            <span
                              className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                              style={{ borderColor: `${color}55`, color, background: `${color}18` }}
                            >
                              {a.riskLevel || 'high'} risk
                            </span>
                          </div>

                          <p className="mt-3 text-sm leading-6 text-neutral-400">{hint}</p>
                          <p className="mt-1 text-xs leading-5 text-neutral-500">
                            <Eye size={11} className="mr-1 inline" />
                            Blast radius: {blastRadius(a)}
                          </p>

                          <div className="mt-4">
                            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
                              <FileDiff size={12} /> What will change
                            </div>
                            {rows.length > 0 ? (
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
                                {JSON.stringify(a.input ?? {}, null, 2)}
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
                      href="/app/chat"
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
        <div className="space-y-3">
          {decided.length === 0 && !loading && (
            <GlassCard className="p-6 text-sm text-neutral-400" hoverLift={false}>
              No decided actions yet. After you Approve or Reject, they appear here as your audit trail.
            </GlassCard>
          )}
          {decided.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-5 py-3.5 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium text-neutral-200">{humanTitle(a)}</div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {a.tool}.{a.action}
                  {a.createdAt ? ` · requested ${new Date(a.createdAt).toLocaleString()}` : ''}
                  {a.executedAt ? ` · executed ${new Date(a.executedAt).toLocaleString()}` : ''}
                  {a.executionStatus ? ` · execution: ${a.executionStatus}` : ''}
                  {a.executionVerified ? ' · verified' : ''}
                  {(a.executionResult?.output as any)?.key
                    ? ` · ${(a.executionResult!.output as any).key}`
                    : (a.executionResult?.output as any)?.id
                      ? ` · ${(a.executionResult!.output as any).id}`
                      : ''}
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide',
                  a.status === 'approved' ? 'text-emerald-400' : 'text-rose-400'
                )}
              >
                {a.status === 'approved' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <Link href="/app/chat" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white">
        <ArrowLeft size={12} /> Back to chat
      </Link>
    </div>
  );
}
