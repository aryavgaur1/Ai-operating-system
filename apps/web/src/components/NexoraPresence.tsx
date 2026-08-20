'use client';

import { cn } from '@/lib/utils';

export type NexoraAgentState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'tool'
  | 'speaking'
  | 'success'
  | 'error';

const STATE_LABEL: Record<NexoraAgentState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  tool: 'Working',
  speaking: 'Speaking',
  success: 'Done',
  error: 'Needs attention',
};

/**
 * Compact OS-style presence indicator for Nexora (Jarvis-inspired, not decorative noise).
 */
export function NexoraPresence({
  state,
  className,
}: {
  state: NexoraAgentState;
  className?: string;
}) {
  const ring =
    state === 'listening'
      ? 'border-rose-400/50 shadow-[0_0_24px_rgba(251,113,133,0.25)]'
      : state === 'speaking'
        ? 'border-accent2/50 shadow-[0_0_24px_rgba(139,233,208,0.22)]'
        : state === 'tool' || state === 'thinking'
          ? 'border-accent/50 shadow-[0_0_24px_rgba(91,157,255,0.25)]'
          : state === 'error'
            ? 'border-rose-500/40'
            : state === 'success'
              ? 'border-emerald-400/40'
              : 'border-white/15';

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className={cn('relative flex h-11 w-11 items-center justify-center rounded-full border', ring)}>
        <span
          className={cn(
            'absolute inset-0 rounded-full opacity-40',
            (state === 'listening' || state === 'speaking' || state === 'thinking' || state === 'tool') &&
              'animate-pulse bg-accent/20'
          )}
        />
        <span
          className={cn(
            'relative h-2.5 w-2.5 rounded-full',
            state === 'listening' && 'bg-rose-300',
            state === 'speaking' && 'bg-accent2',
            (state === 'thinking' || state === 'tool') && 'bg-accent',
            state === 'success' && 'bg-emerald-300',
            state === 'error' && 'bg-rose-400',
            state === 'idle' && 'bg-neutral-400'
          )}
        />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">Nexora</div>
        <div className="truncate text-sm text-neutral-200">{STATE_LABEL[state]}</div>
      </div>
    </div>
  );
}

/** Strip markdown-ish markup for speech synthesis. */
export function speakableText(markdown: string, maxChars = 600): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

export function canUseSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

export function speakNexora(
  text: string,
  opts: {
    muted?: boolean;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: () => void;
  } = {}
): SpeechSynthesisUtterance | null {
  if (opts.muted || !canUseSpeechSynthesis()) return null;
  const clean = speakableText(text);
  if (!clean) return null;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.02;
    u.pitch = 1;
    u.onstart = () => opts.onStart?.();
    u.onend = () => opts.onEnd?.();
    u.onerror = () => opts.onError?.();
    window.speechSynthesis.speak(u);
    return u;
  } catch {
    opts.onError?.();
    return null;
  }
}

export function stopNexoraSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
