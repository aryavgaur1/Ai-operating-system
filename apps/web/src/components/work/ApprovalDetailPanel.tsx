'use client';

import Link from 'next/link';
import type { ApprovalRequest } from '@/lib/api';
import { buildActionPreviewFromApproval, serviceLabel } from '@/lib/actionPlan';
import {
  approvalActionTitle,
  approvalWillChange,
  blastRadius,
  diffRows,
  draftValue,
  editableFieldsFor,
  formatDateTime,
} from '@/lib/approvalWork';
import { APP_ROUTES, chatConversationPath } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function ApprovalDetailPanel({
  approval,
  workspaceName,
  currentUserId,
  memberNames,
  drafts,
  onDraftChange,
}: {
  approval: ApprovalRequest;
  workspaceName: string;
  currentUserId?: string;
  memberNames?: Record<string, string>;
  drafts: Record<string, Record<string, string>>;
  onDraftChange: (id: string, key: string, value: string) => void;
}) {
  const preview = buildActionPreviewFromApproval(approval, workspaceName);
  const requestedBy =
    approval.requestedByUserId && approval.requestedByUserId === currentUserId
      ? 'You'
      : approval.requestedByUserId && memberNames?.[approval.requestedByUserId]
        ? memberNames[approval.requestedByUserId]
        : approval.requestedByUserId
          ? 'Workspace member'
          : '—';

  const editable = editableFieldsFor(approval);
  const rows = diffRows(approval.input || {});

  return (
    <div className="border-t border-white/10 bg-black/20 px-4 py-4 text-sm">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[10px] uppercase text-neutral-500">Action</dt>
          <dd className="mt-1 font-medium text-white">{approvalActionTitle(approval)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-neutral-500">Service</dt>
          <dd className="mt-1 text-neutral-300">{serviceLabel(approval.tool)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-neutral-500">Requested by</dt>
          <dd className="mt-1 text-neutral-300">{requestedBy}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-neutral-500">Workspace</dt>
          <dd className="mt-1 text-neutral-300">{workspaceName}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-neutral-500">Created</dt>
          <dd className="mt-1 text-neutral-400">{formatDateTime(approval.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-neutral-500">Risk</dt>
          <dd className={cn('mt-1 capitalize', preview.riskLevel === 'high' ? 'text-rose-300' : 'text-neutral-300')}>
            {preview.riskLevel} — {preview.risk}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="text-[10px] uppercase text-neutral-500">What will change</div>
        <ul className="mt-2 space-y-1 text-neutral-300">
          {approvalWillChange(approval).map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 text-xs text-neutral-500">
        <span className="text-neutral-400">Context:</span> {blastRadius(approval)}
      </div>

      {editable.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="text-[10px] uppercase text-neutral-500">Edit before approve</div>
          {editable.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1 block text-xs text-neutral-500">{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={draftValue(approval, drafts, field.key)}
                  onChange={(e) => onDraftChange(approval.id, field.key, e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
                />
              ) : (
                <input
                  value={draftValue(approval, drafts, field.key)}
                  onChange={(e) => onDraftChange(approval.id, field.key, e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
                />
              )}
            </label>
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[120px_1fr] gap-3 border-b border-white/5 px-3 py-2 text-xs last:border-0">
              <span className="text-neutral-500">{row.label}</span>
              <span className="text-neutral-200">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {approval.conversationId ? (
        <Link
          href={chatConversationPath(approval.conversationId)}
          className="mt-4 inline-block text-xs text-accent hover:text-white"
        >
          View originating command
        </Link>
      ) : null}
    </div>
  );
}
