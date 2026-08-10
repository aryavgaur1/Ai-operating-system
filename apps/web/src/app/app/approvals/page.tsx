'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { api, type ApprovalRequest } from '@/lib/api';
import { GlassCard, Reveal } from '@/components/motion';
import { RiskRadial } from '@/components/charts';
import { cn } from '@/lib/utils';

const riskScore: Record<string, number> = { low: 24, medium: 58, high: 88 };
const riskColor: Record<string, string> = { low: '#8be9d0', medium: '#f5b95d', high: '#fb7185' };
const riskCopy: Record<string, string> = {
  low: 'Reversible action with minimal blast radius. Safe for quick review.',
  medium: 'Touches shared systems or external-facing records. Worth a careful look.',
  high: 'Externally visible or hard to reverse. Review input carefully before approving.',
};

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .listApprovals()
      .then((res) => setApprovals(res.approvals))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (decidingId) return; // double-click guard
    setDecidingId(id);
    setError(null);
    try {
      const res = await api.decideApproval(id, decision);
      if (decision === 'approved') {
        const out = res.executionResult;
        if (out?.ok && !out.mocked) {
          const o = (out.output || {}) as Record<string, unknown>;
          const key = o.key || o.id || o.ts;
          const url = o.url;
          const msg = key
            ? `Approved and created ${key}${url ? ` — ${url}` : ''}`
            : `Approved and executed ${res.approval.tool}.${res.approval.action} (verified).`;
          window.sessionStorage.setItem('nexora:approvalFlash', msg);
          window.location.href = '/app/chat';
          return;
        }
        load();
        if (out?.mocked) {
          setError(
            out.error ||
              'Mock result rejected — connect the live integration under Integrations, then retry Approve & run.'
          );
        } else if (out && !out.ok) {
          setError(out.error || 'Approved, but execution failed.');
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

  const pending = approvals.filter((a) => a.status === 'pending');
  const decided = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="space-y-6 pb-10">
      <Reveal>
        <GlassCard variant="glow" className="p-7" hoverLift={false}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="badge border-white/10 bg-white/5 text-white">
                <ShieldAlert size={12} className="text-accent2" /> Human-in-the-loop
              </span>
              <h1 className="font-display mt-4 text-3xl font-semibold text-white sm:text-4xl">Approvals</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-400">
                High-consequence actions — external emails, CRM updates, and ticket changes — pause here for human
                review before execution.
              </p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/25 px-6 py-5 text-center">
              <div className="text-3xl font-semibold text-white">{pending.length}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.24em] text-neutral-500">awaiting review</div>
            </div>
          </div>
        </GlassCard>
      </Reveal>

      {error && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      )}

      <div className="space-y-5">
        <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Pending ({pending.length})</div>

        {pending.length === 0 && !loading && (
          <GlassCard className="p-6 text-sm text-neutral-400" hoverLift={false}>
            No pending approvals right now — try asking the agent to draft an email or update a CRM record from Chat.
          </GlassCard>
        )}

        <div className="grid gap-5">
          <AnimatePresence>
            {pending.map((a) => {
              const score = riskScore[a.riskLevel] ?? 40;
              const color = riskColor[a.riskLevel] ?? '#5b9dff';
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
                            <div className="code text-lg font-semibold text-white">
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

                        <p className="mt-3 text-sm leading-6 text-neutral-400">
                          {riskCopy[a.riskLevel] || riskCopy.high}
                        </p>

                        <div className="mt-4">
                          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-neutral-500">Preview</div>
                          <pre className="code thin-scroll max-h-40 overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs leading-6 text-neutral-300">
                            {JSON.stringify(a.input ?? {}, null, 2)}
                          </pre>
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
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {decided.length > 0 && (
          <div>
            <div className="mb-4 text-xs uppercase tracking-[0.24em] text-neutral-500">Decided actions</div>
            <div className="space-y-2.5">
              {decided.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-5 py-3.5 text-sm">
                  <div className="min-w-0">
                    <span className="code text-neutral-300">
                      {a.tool}.{a.action}
                    </span>
                    {a.executionStatus && (
                      <div className="mt-1 text-[11px] text-neutral-500">
                        execution: {a.executionStatus}
                        {a.executionVerified ? ' · verified' : ''}
                        {(a.executionResult?.output as any)?.key
                          ? ` · ${(a.executionResult!.output as any).key}`
                          : (a.executionResult?.output as any)?.id
                            ? ` · ${(a.executionResult!.output as any).id}`
                            : ''}
                      </div>
                    )}
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
          </div>
        )}
      </div>

      <Link href="/app/chat" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white">
        <ArrowLeft size={12} /> Back to chat
      </Link>
    </div>
  );
}
