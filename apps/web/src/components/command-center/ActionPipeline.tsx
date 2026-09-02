import { cn } from '@/lib/utils';

export type ActionPhase = 'intent' | 'plan' | 'approval' | 'execution' | 'result' | 'failed';

const STEPS: { id: ActionPhase; label: string }[] = [
  { id: 'intent', label: 'Intent' },
  { id: 'plan', label: 'Plan' },
  { id: 'approval', label: 'Approval' },
  { id: 'execution', label: 'Execution' },
  { id: 'result', label: 'Result' },
];

function stepIndex(phase: ActionPhase): number {
  if (phase === 'failed') return 3;
  return STEPS.findIndex((s) => s.id === phase);
}

export function ActionPipeline({ phase }: { phase: ActionPhase }) {
  const activeIdx = stepIndex(phase);
  const failed = phase === 'failed';

  return (
    <nav aria-label="Action progress" className="mb-4 overflow-x-auto">
      <ol className="flex min-w-[520px] items-center gap-1">
        {STEPS.map((step, idx) => {
          const done = failed ? idx < 3 : idx < activeIdx;
          const active = !failed && idx === activeIdx;
          const stepFailed = failed && idx === 3;

          return (
            <li key={step.id} className="flex flex-1 items-center gap-1">
              <div
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide',
                  done && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
                  active && 'border-accent/40 bg-accent/10 text-white',
                  stepFailed && 'border-rose-500/30 bg-rose-500/10 text-rose-200',
                  !done && !active && !stepFailed && 'border-white/10 text-neutral-500'
                )}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px]',
                    done && 'bg-emerald-500/30',
                    active && 'bg-accent/30',
                    stepFailed && 'bg-rose-500/30',
                    !done && !active && !stepFailed && 'bg-white/10'
                  )}
                  aria-hidden
                >
                  {done ? '✓' : idx + 1}
                </span>
                <span className="truncate">{step.label}</span>
              </div>
              {idx < STEPS.length - 1 ? (
                <span className="h-px w-2 shrink-0 bg-white/10" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function resolveActionPhase(input: {
  loading?: boolean;
  pendingApproval?: boolean;
  executing?: boolean;
  hasResult?: boolean;
  failed?: boolean;
}): ActionPhase | null {
  if (input.failed) return 'failed';
  if (input.hasResult) return 'result';
  if (input.executing) return 'execution';
  if (input.pendingApproval) return 'approval';
  if (input.loading) return 'intent';
  return null;
}
