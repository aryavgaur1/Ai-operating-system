'use client';

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import type { ActionPreview } from '@/lib/actionPlan';
import { APP_ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

const riskTone: Record<string, string> = {
  low: 'text-emerald-300',
  medium: 'text-amber-300',
  high: 'text-rose-300',
};

export function ActionPreviewCard({
  preview,
  approvalId,
  onApprove,
  onCancel,
  approving,
}: {
  preview: ActionPreview;
  approvalId?: string;
  onApprove: () => void;
  onCancel?: () => void;
  approving?: boolean;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-amber-500/25 bg-[#0f1118]">
      <div className="border-b border-white/10 bg-amber-500/5 px-4 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-amber-200">Action proposed</div>
      </div>

      <div className="space-y-4 p-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Action</dt>
            <dd className="mt-1 font-medium text-white">{preview.title}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Service</dt>
            <dd className="mt-1 text-neutral-200">{preview.service}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Target</dt>
            <dd className="mt-1 text-neutral-200">{preview.target}</dd>
          </div>
        </dl>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">What will change</div>
          <ul className="mt-2 space-y-1 text-neutral-300">
            {preview.willChange.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-neutral-600">·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Steps</div>
          <ol className="mt-2 space-y-1.5">
            {preview.steps.map((step, i) => (
              <li key={step.id} className="flex items-center gap-2 text-neutral-300">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 text-[10px] text-neutral-500">
                  {i + 1}
                </span>
                {step.label}
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Risk</div>
          <div className={cn('mt-1 text-xs font-medium uppercase', riskTone[preview.riskLevel])}>
            {preview.riskLevel}
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-400">{preview.risk}</p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={approving}
              className="nx-btn-secondary px-4 py-2 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
          {approvalId ? (
            <Link
              href={`${APP_ROUTES.approvals}?focus=${encodeURIComponent(approvalId)}`}
              className="nx-btn-secondary px-4 py-2 text-xs"
            >
              View full plan
            </Link>
          ) : null}
          <button
            type="button"
            disabled={approving}
            onClick={onApprove}
            className="nx-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldAlert size={12} />
            {approving ? 'Running…' : 'Approve & run'}
          </button>
        </div>
      </div>
    </div>
  );
}
