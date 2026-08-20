'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ClipboardList,
  ChevronDown,
  Mail,
  Mic,
  MicOff,
  Plus,
  Search,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NexoraAgentState } from '@/components/NexoraPresence';
import type { BuiltGreeting } from '@/lib/jarvisGreeting';
import type { JarvisSuggestion } from '@/lib/jarvisStatus';

export type JarvisUiMode = 'orb' | 'expanded' | 'voice';

type MiniTurn = { role: 'user' | 'assistant'; content: string };

const ICON_MAP = {
  mail: Mail,
  work: ClipboardList,
  today: BarChart3,
  slack: Search,
  jira: ClipboardList,
} as const;

function Waveform({ active, variant }: { active: boolean; variant: 'listen' | 'speak' | 'idle' }) {
  const bars = variant === 'idle' ? 5 : 9;
  return (
    <div className="flex h-5 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'w-[2.5px] rounded-full bg-white/90',
            active && variant === 'listen' && 'jarvis-wave-listen',
            active && variant === 'speak' && 'jarvis-wave-speak',
            variant === 'idle' && 'jarvis-wave-idle',
            !active && 'opacity-50'
          )}
          style={{
            height: variant === 'idle' ? 6 + (i % 3) * 2 : 8 + (i % 4) * 3,
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}

function JarvisOrbCore({
  state,
  size = 'md',
  muted = false,
}: {
  state: NexoraAgentState;
  size?: 'sm' | 'md' | 'lg';
  muted?: boolean;
}) {
  const dim =
    size === 'lg' ? 'h-28 w-28 sm:h-32 sm:w-32' : size === 'sm' ? 'h-[4.25rem] w-[4.25rem]' : 'h-16 w-16';
  const listening = state === 'listening';
  const speaking = state === 'speaking';
  const working = state === 'thinking' || state === 'tool';

  return (
    <div className={cn('relative flex items-center justify-center', dim)}>
      <span
        className={cn(
          'absolute inset-0 rounded-full bg-[#1a4cff]/25 blur-md transition-opacity',
          (listening || speaking || working) && !muted && 'opacity-100',
          state === 'idle' && !muted && 'jarvis-breathe opacity-70',
          muted && 'opacity-40 grayscale'
        )}
      />
      <span
        className={cn(
          'absolute inset-[10%] rounded-full border border-[#5b9dff]/35',
          working && !muted && 'jarvis-ring-spin border-[#5b9dff]/55',
          listening && 'animate-pulse border-rose-300/40',
          muted && 'border-neutral-500/40'
        )}
      />
      <span
        className={cn(
          'absolute inset-[22%] rounded-full bg-gradient-to-br from-[#4d8dff] via-[#2f6dff] to-[#1a4cff] shadow-[0_0_28px_rgba(59,130,246,0.45)]',
          state === 'idle' && !muted && 'jarvis-breathe',
          muted && 'from-neutral-500 via-neutral-600 to-neutral-700 shadow-none'
        )}
      />
      <div className="relative z-[1] px-2">
        {muted ? (
          <VolumeX size={size === 'sm' ? 16 : 18} className="text-white/80" />
        ) : (
          <Waveform
            active={listening || speaking || state === 'idle'}
            variant={listening ? 'listen' : speaking ? 'speak' : 'idle'}
          />
        )}
      </div>
    </div>
  );
}

export function JarvisLayer({
  mode,
  agentState,
  statusLine,
  greeting,
  suggestions,
  speechBlocked,
  wakeEnabled,
  micActive,
  busy,
  turns,
  voiceMuted,
  onSetMode,
  onEnableVoice,
  onToggleMic,
  onToggleMute,
  onInterrupt,
  onSend,
  onSuggestion,
  onToggleWake,
}: {
  mode: JarvisUiMode;
  agentState: NexoraAgentState;
  statusLine: string;
  greeting: BuiltGreeting | null;
  suggestions: JarvisSuggestion[];
  speechBlocked: boolean;
  wakeEnabled: boolean;
  micActive: boolean;
  busy: boolean;
  turns: MiniTurn[];
  voiceMuted: boolean;
  onSetMode: (m: JarvisUiMode) => void;
  onEnableVoice: () => void;
  onToggleMic: () => void;
  onToggleMute: () => void;
  onInterrupt: () => void;
  onSend: (text: string) => void;
  onSuggestion: (prompt: string) => void;
  onToggleWake: () => void;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode !== 'orb') {
      const t = window.setTimeout(() => inputRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
  }, [mode]);

  const headline = useMemo(() => {
    if (greeting?.spokenText) return greeting.spokenText;
    return "I'm Nexora. How can I help you today?";
  }, [greeting]);

  if (mode === 'orb') {
    return (
      <div
        className="pointer-events-none fixed right-4 z-[240] sm:bottom-8 sm:right-6"
        style={{ bottom: 'max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.5rem))' }}
      >
        <button
          type="button"
          aria-label="Open Jarvis"
          onClick={() => onSetMode('expanded')}
          className="pointer-events-auto rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <JarvisOrbCore state={agentState} size="sm" muted={voiceMuted} />
        </button>
      </div>
    );
  }

  const panelWide = mode === 'voice';

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[240] flex justify-center px-3',
        'sm:bottom-6 sm:justify-end sm:px-6'
      )}
      style={{ bottom: 'max(5.25rem, calc(env(safe-area-inset-bottom, 0px) + 4.25rem))' }}
    >
      <div
        className={cn(
          'pointer-events-auto w-full overflow-hidden rounded-[28px] border border-white/10',
          'bg-[#070b14]/92 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl',
          panelWide ? 'max-w-2xl sm:mr-2' : 'max-w-lg sm:mr-2',
          'max-h-[min(78vh,640px)] sm:max-h-[min(72vh,620px)]'
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">Nexora OS</div>
            <div className="text-xs text-neutral-400">Your AI Operating System</div>
          </div>
          <div className="flex items-center gap-2">
            {speechBlocked ? (
              <button
                type="button"
                aria-label="Enable Jarvis voice"
                onClick={onEnableVoice}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] text-accent"
              >
                <Volume2 size={12} /> Enable voice
              </button>
            ) : null}
            <button
              type="button"
              aria-label="New request"
              title="New request"
              onClick={() => {
                onSetMode('voice');
                inputRef.current?.focus();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3b82f6] text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] hover:bg-[#2563eb]"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        <div className={cn('grid gap-4 overflow-y-auto px-5 pb-4', panelWide ? 'sm:grid-cols-[1.15fr_0.85fr]' : '')}>
          <div className="min-w-0">
            <p className="text-[15px] leading-relaxed text-white/95">{headline}</p>

            {turns.length > 0 ? (
              <div className="mt-3 max-h-36 space-y-2 overflow-y-auto pr-1 text-sm">
                {turns.slice(-4).map((t, i) => (
                  <div
                    key={`${t.role}-${i}`}
                    className={cn(
                      'rounded-2xl px-3 py-2',
                      t.role === 'user' ? 'bg-white/5 text-neutral-200' : 'bg-accent/10 text-neutral-100'
                    )}
                  >
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-neutral-500">
                      {t.role === 'user' ? 'You' : 'Nexora'}
                    </span>
                    {t.content.slice(0, 280)}
                    {t.content.length > 280 ? '…' : ''}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {suggestions.slice(0, 4).map((s) => {
                  const Icon = ICON_MAP[s.icon] || Search;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onSuggestion(s.prompt)}
                      className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-left text-sm text-neutral-200 transition hover:border-[#5b9dff]/40 hover:bg-[#5b9dff]/10"
                    >
                      <Icon size={15} className="shrink-0 text-[#8eb6ff]" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-center py-2">
            <JarvisOrbCore state={agentState} size={panelWide ? 'lg' : 'md'} muted={voiceMuted} />
            <div className="mt-3 text-sm text-[#9ec0ff]">{statusLine}</div>
            {agentState === 'speaking' ? (
              <button
                type="button"
                aria-label="Stop speaking"
                onClick={onInterrupt}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs text-neutral-300 hover:bg-white/5"
              >
                <Square size={10} /> Stop
              </button>
            ) : null}
          </div>
        </div>

        <div className="border-t border-white/8 px-4 py-3">
          <form
            className="flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-2 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const t = draft.trim();
              if (!t || busy) return;
              setDraft('');
              onSend(t);
            }}
          >
            <button
              type="button"
              onClick={onToggleMic}
              aria-label={micActive ? 'Stop listening' : 'Start listening'}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                micActive ? 'bg-rose-500/20 text-rose-300' : 'text-neutral-400 hover:bg-white/5 hover:text-white'
              )}
            >
              {micActive ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={voiceMuted ? 'Unmute Jarvis' : 'Mute Jarvis'}
              title={voiceMuted ? 'Unmute voice output' : 'Mute voice output (mic still works)'}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                voiceMuted ? 'bg-white/10 text-neutral-400' : 'text-[#8eb6ff] hover:bg-white/5'
              )}
            >
              {voiceMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask Nexora anything."
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-full bg-[#3b82f6] px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Send
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between gap-2 px-1">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                checked={wakeEnabled}
                onChange={onToggleWake}
                className="rounded border-white/20 bg-transparent"
              />
              Wake phrase “Hey Nexora” (opt-in)
            </label>
            <span className="hidden text-[10px] text-neutral-600 sm:inline">⌘/Ctrl + J</span>
          </div>
        </div>

        <div className="flex justify-center pb-3">
          <button
            type="button"
            aria-label="Close Jarvis"
            onClick={() => onSetMode('orb')}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-400 hover:text-white"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
