'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApprovalRequest } from '@/lib/api';

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
    setDecidingId(id);
    try {
      await api.decideApproval(id, decision);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDecidingId(null);
    }
  }

  const pending = approvals.filter((a) => a.status === 'pending');
  const decided = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="space-y-8">
      <section className="rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-glow">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="badge badge-pill bg-white/5 text-white border-white/10">
              <span className="dot bg-accent2" /> Human-in-the-loop
            </span>
            <h1 className="font-display mt-4 text-4xl font-semibold text-white">Approvals</h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-neutral-300">
              High-consequence actions — external emails, CRM updates, and ticket changes — pause here for human review before execution.
            </p>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-[#09101f] p-5 text-sm text-neutral-300">
            <div className="font-semibold text-white">Approval console</div>
            <div className="mt-2 text-xs uppercase tracking-[0.25em] text-neutral-500">Trusted decision workflow</div>
          </div>
        </div>
      </section>

      {error && <div className="rounded-[28px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
      {loading && <div className="text-sm text-neutral-400">Loading approvals…</div>}

      <section className="space-y-6">
        <div>
          <div className="font-display mb-4 text-xl font-semibold text-white">Pending ({pending.length})</div>
          {pending.length === 0 && !loading && (
            <div className="rounded-[28px] border border-white/10 bg-black/20 p-6 text-sm text-neutral-300">
              No pending approvals right now — try asking the agent to draft an email or update a CRM record from Chat.
            </div>
          )}

          <div className="space-y-4">
            {pending.map((a) => (
              <div key={a.id} className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-glow">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-white">{a.tool}.{a.action}</div>
                    <div className="mt-2 text-sm text-neutral-400">Risk: <span className="text-accent">{a.riskLevel}</span></div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <span className="badge bg-white/5 text-neutral-300 border-white/10">Pending review</span>
                    <span className="badge bg-white/5 text-neutral-300 border-white/10">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                <pre className="mt-5 overflow-x-auto rounded-[24px] bg-black/40 p-4 text-xs text-neutral-300">
                  {JSON.stringify(a.input, null, 2)}
                </pre>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    onClick={() => decide(a.id, 'approved')}
                    disabled={decidingId === a.id}
                    className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-[#04101f] hover:bg-[#72b8ff] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Approve &amp; run
                  </button>
                  <button
                    onClick={() => decide(a.id, 'rejected')}
                    disabled={decidingId === a.id}
                    className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-300 hover:text-white"
                  >
                    Reject
                  </button>
                  <Link href="/chat" className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-300 hover:text-white">
                    Back to chat
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {decided.length > 0 && (
          <div>
            <div className="font-display mb-4 text-xl font-semibold text-white">Decided actions</div>
            <div className="space-y-3">
              {decided.map((a) => (
                <div key={a.id} className="rounded-[28px] border border-white/10 bg-black/20 p-4 text-sm text-neutral-300">
                  <div className="flex items-center justify-between gap-3">
                    <span>{a.tool}.{a.action}</span>
                    <span className={a.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}>{a.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
