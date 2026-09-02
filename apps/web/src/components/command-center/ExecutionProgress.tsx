'use client';

import { Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ExecutionStepState = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
};

export function ExecutionProgress({ steps }: { steps: ExecutionStepState[] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-sky-500/25 bg-[#0f1118]">
      <div className="border-b border-white/10 bg-sky-500/5 px-4 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-sky-200">Executing</div>
      </div>
      <ul className="space-y-0 divide-y divide-white/5 p-4">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3 py-2.5 text-sm">
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <div className={cn('text-neutral-200', step.status === 'pending' && 'text-neutral-500')}>
                {step.label}
              </div>
              {step.status === 'done' ? (
                <div className="text-xs text-emerald-400">completed</div>
              ) : null}
              {step.status === 'failed' && step.error ? (
                <div className="mt-1 text-xs text-rose-300">{step.error}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepIcon({ status }: { status: ExecutionStepState['status'] }) {
  if (status === 'done') {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <Check size={12} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
        <X size={12} />
      </span>
    );
  }
  if (status === 'running') {
    return <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-sky-300" />;
  }
  return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-600" />;
}
