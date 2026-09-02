'use client';

import { Suspense, useEffect, useMemo, useState, Fragment } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type ApprovalRequest } from '@/lib/api';
import {
  approvalActionTitle,
  approvalTargetSummary,
  buildInputPatch,
  formatDateTime,
} from '@/lib/approvalWork';
import { serviceLabel, executionArtifacts } from '@/lib/actionPlan';
import { chatConversationPath, chatResumeHref } from '@/lib/routes';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { WorkPageHeader } from '@/components/work/WorkPageHeader';
import { WorkPanel } from '@/components/work/WorkPanel';
import { WorkAlert } from '@/components/work/WorkAlert';
import { WorkEmpty } from '@/components/work/WorkEmpty';
import { WorkLoading } from '@/components/work/WorkLoading';
import { ApprovalDetailPanel } from '@/components/work/ApprovalDetailPanel';
import { WorkTable, WorkTableCell, WorkTableRow } from '@/components/work/WorkTable';
import { cn } from '@/lib/utils';

function ApprovalsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams?.get('focus') || '';
  const { current } = useWorkspaces();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(focusId || null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();

  function load() {
    setLoading(true);
    api
      .listApprovals()
      .then((res) => setApprovals(res.approvals || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.me().then((r) => setCurrentUserId(r.user.id)).catch(() => undefined);
  }, [current?.organizationId]);

  useEffect(() => {
    if (focusId) setExpandedId(focusId);
  }, [focusId]);

  const pending = useMemo(() => approvals.filter((a) => a.status === 'pending'), [approvals]);
  const decided = useMemo(
    () =>
      [...approvals]
        .filter((a) => a.status !== 'pending')
        .sort((a, b) => Date.parse(b.executedAt || b.createdAt) - Date.parse(a.executedAt || a.createdAt)),
    [approvals]
  );

  function setDraftField(id: string, key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  }

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (decidingId) return;
    setDecidingId(id);
    setError(null);
    try {
      const target = approvals.find((a) => a.id === id);
      const patch = decision === 'approved' && target ? buildInputPatch(target, drafts) : undefined;
      const res = await api.decideApproval(id, decision, patch);
      if (decision === 'approved') {
        const out = res.executionResult;
        if (out?.ok && !out.mocked) {
          const remaining = pending.filter((p) => p.id !== id);
          load();
          if (remaining.length === 0) {
            const conv = res.approval.conversationId || target?.conversationId || '';
            router.push(conv ? chatConversationPath(conv) : chatResumeHref());
          }
          return;
        }
        load();
        if (out?.mocked) {
          setError(out.error || 'Connect the live integration under Integrations, then retry.');
        } else if (out && !out.ok) {
          setError(out.error || 'Approved, but execution failed.');
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

  return (
    <div className="space-y-6">
      <WorkPageHeader
        title="Approvals"
        description={`Review proposed actions before they run in ${current?.name ?? 'this workspace'}.`}
        meta={
          <span>
            <span className="text-white">{pending.length}</span> pending
          </span>
        }
      />

      {error ? <WorkAlert variant="error">{error}</WorkAlert> : null}

      <WorkPanel title="Pending" flush>
          {loading ? (
            <WorkLoading />
          ) : pending.length === 0 ? (
            <WorkEmpty>
              <p>No actions waiting for approval.</p>
              <Link href={chatResumeHref()} className="focus-ring mt-2 inline-block text-accent">
                Open command
              </Link>
            </WorkEmpty>
          ) : (
            <div>
              <WorkTable columns={['Action', 'Target', 'Service', 'Risk', 'Created', 'Actions']} caption="Pending approvals">
                {pending.map((a) => (
                  <Fragment key={a.id}>
                    <WorkTableRow>
                      <WorkTableCell className="font-medium text-white">{approvalActionTitle(a)}</WorkTableCell>
                      <WorkTableCell className="max-w-[180px] truncate">{approvalTargetSummary(a)}</WorkTableCell>
                      <WorkTableCell>{serviceLabel(a.tool)}</WorkTableCell>
                      <WorkTableCell>
                        <span
                          className={cn(
                            'text-xs uppercase',
                            a.riskLevel === 'high' ? 'text-rose-300' : a.riskLevel === 'medium' ? 'text-amber-300' : 'text-emerald-300'
                          )}
                        >
                          {a.riskLevel}
                        </span>
                      </WorkTableCell>
                      <WorkTableCell className="text-neutral-500">{formatDateTime(a.createdAt)}</WorkTableCell>
                      <WorkTableCell>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={decidingId === a.id}
                            onClick={() => decide(a.id, 'approved')}
                            className="nx-btn-primary px-2.5 py-1 text-xs disabled:opacity-50"
                          >
                            {decidingId === a.id ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={decidingId === a.id}
                            onClick={() => decide(a.id, 'rejected')}
                            className="nx-btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedId((id) => (id === a.id ? null : a.id))}
                            className="nx-btn-ghost border border-white/10 px-2.5 py-1 text-xs"
                          >
                            {expandedId === a.id ? 'Hide' : 'Details'}
                          </button>
                        </div>
                      </WorkTableCell>
                    </WorkTableRow>
                    {expandedId === a.id ? (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <ApprovalDetailPanel
                            approval={a}
                            workspaceName={current?.name ?? 'Workspace'}
                            currentUserId={currentUserId}
                            drafts={drafts}
                            onDraftChange={setDraftField}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </WorkTable>
            </div>
          )}
      </WorkPanel>

      <WorkPanel title="History" flush>
          {loading ? (
            <WorkLoading />
          ) : decided.length === 0 ? (
            <WorkEmpty>No decided approvals yet.</WorkEmpty>
          ) : (
            <WorkTable columns={['Action', 'Service', 'Status', 'Result', 'When']} caption="Approval history">
              {decided.slice(0, 25).map((a) => {
                const failed =
                  a.status === 'approved' &&
                  (a.executionStatus === 'failed' || a.executionResult?.ok === false);
                const arts = executionArtifacts(
                  { tool: a.tool, action: a.action, input: a.input },
                  a.executionResult
                );
                return (
                  <WorkTableRow key={a.id}>
                    <WorkTableCell className="text-white">{approvalActionTitle(a)}</WorkTableCell>
                    <WorkTableCell>{serviceLabel(a.tool)}</WorkTableCell>
                    <WorkTableCell>
                      <span
                        className={cn(
                          'text-xs uppercase',
                          a.status === 'rejected'
                            ? 'text-neutral-500'
                            : failed
                              ? 'text-rose-300'
                              : 'text-emerald-300'
                        )}
                      >
                        {a.status === 'rejected' ? 'rejected' : failed ? 'failed' : 'done'}
                      </span>
                    </WorkTableCell>
                    <WorkTableCell className="max-w-xs truncate text-neutral-400">
                      {failed
                        ? a.executionResult?.error || 'Failed'
                        : arts.primary || arts.headline || '—'}
                    </WorkTableCell>
                    <WorkTableCell className="text-neutral-500">
                      {formatDateTime(a.executedAt || a.createdAt)}
                    </WorkTableCell>
                  </WorkTableRow>
                );
              })}
            </WorkTable>
          )}
      </WorkPanel>
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<WorkLoading label="Loading approvals…" />}>
      <ApprovalsPageInner />
    </Suspense>
  );
}
