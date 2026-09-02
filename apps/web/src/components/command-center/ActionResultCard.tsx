'use client';

import { ExternalLink } from 'lucide-react';
import { openLabelFor, type ActionOutcomeView } from '@/lib/actionOutcomes';
import { serviceLabel } from '@/lib/actionPlan';

export function ActionResultCard({ outcome }: { outcome: ActionOutcomeView }) {
  if (outcome.status === 'failed') {
    return (
      <div className="mt-4 overflow-hidden rounded-lg border border-rose-500/30 bg-rose-500/5">
        <div className="border-b border-rose-500/20 px-4 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-rose-200">Action failed</div>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <p className="text-neutral-200">{outcome.summary}</p>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">Reason</div>
            <p className="mt-1 text-rose-200">{outcome.summary}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-emerald-500/25 bg-emerald-500/5">
      <div className="border-b border-emerald-500/20 px-4 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-200">Completed</div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
        <div>
          <p className="font-medium text-white">{outcome.summary}</p>
          {outcome.resource ? (
            <p className="mt-1 text-lg text-neutral-200">{outcome.resource}</p>
          ) : null}
          <p className="mt-1 text-xs text-neutral-500">{serviceLabel(outcome.integration)}</p>
        </div>
        {outcome.resourceUrl ? (
          <a
            href={outcome.resourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring nx-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
          >
            {openLabelFor(outcome.integration)}
            <ExternalLink size={12} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function ActionFailureCard({
  title,
  reason,
  onRetry,
  onCancel,
}: {
  title: string;
  reason: string;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-rose-500/30 bg-rose-500/5">
      <div className="border-b border-rose-500/20 px-4 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-rose-200">Action failed</div>
      </div>
      <div className="space-y-3 p-4 text-sm">
        <p className="font-medium text-white">{title}</p>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Reason</div>
          <p className="mt-1 text-rose-200">{reason}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onCancel ? (
            <button type="button" onClick={onCancel} className="nx-btn-secondary px-4 py-2 text-xs">
              Cancel
            </button>
          ) : null}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="nx-btn-secondary px-4 py-2 text-xs font-medium text-white">
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
