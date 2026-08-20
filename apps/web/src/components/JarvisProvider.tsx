'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Volume2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { NexoraPresence, type NexoraAgentState, canUseSpeechSynthesis, stopNexoraSpeech } from '@/components/NexoraPresence';
import {
  buildJarvisGreeting,
  shouldPresentGreeting,
  markGreetingPresented,
  markGreetingSpoken,
  readGreetingSession,
  setPendingJarvisPrompt,
  hasAutoSpeakAttempted,
  markAutoSpeakAttempted,
  clearAutoSpeakAttempts,
  JARVIS_SUGGESTIONS,
  GREETING_SESSION_KEY,
  PENDING_PROMPT_KEY,
  type BuiltGreeting,
} from '@/lib/jarvisGreeting';
import { enableAndSpeak, speakNexoraReliable } from '@/lib/jarvisSpeech';
import { APP_ROUTES, chatResumeHref } from '@/lib/routes';
import { cn } from '@/lib/utils';

const WELCOME_DISMISSED_KEY = 'nexora.jarvis.welcomeDismissed';

type JarvisContextValue = {
  ready: boolean;
  userId: string | null;
  displayName: string | null;
  firstName: string | null;
  greeting: BuiltGreeting | null;
  /** True while the welcome panel should show (first session entry). */
  showWelcome: boolean;
  speechBlocked: boolean;
  pendingSpeechText: string | null;
  agentState: NexoraAgentState;
  setAgentState: (s: NexoraAgentState) => void;
  enableVoice: () => Promise<void>;
  dismissWelcome: () => void;
  runSuggestion: (prompt: string) => void;
};

const JarvisCtx = createContext<JarvisContextValue | null>(null);

function sessionStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function JarvisProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { current, loading: workspaceLoading } = useWorkspaces();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<BuiltGreeting | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [speechBlocked, setSpeechBlocked] = useState(false);
  const [pendingSpeechText, setPendingSpeechText] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<NexoraAgentState>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        const id = me.user.id;
        const name = (me.user.displayName || me.user.email || '').trim() || null;
        setUserId(id);
        setDisplayName(name);
        setReady(true);
      } catch {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize greeting once per browser session when user + workspace are ready.
  // Workspace name refreshes / route changes must not re-greet or cancel a successful speak mark.
  useEffect(() => {
    if (!ready || !userId || workspaceLoading) return;

    const storage = sessionStorageOrNull();
    const built = buildJarvisGreeting({
      displayName,
      workspaceName: current?.name,
    });
    const dismissed = storage?.getItem(WELCOME_DISMISSED_KEY) === '1';

    const restorePresentedWelcome = () => {
      const rec = readGreetingSession(storage);
      if (!rec || rec.userId !== userId || !rec.presented || dismissed) {
        setShowWelcome(false);
        return;
      }
      setGreeting(built);
      setShowWelcome(true);
      if (!rec.spoken) {
        setPendingSpeechText(built.spokenText);
        setSpeechBlocked(true);
      }
    };

    if (!shouldPresentGreeting(userId, storage)) {
      restorePresentedWelcome();
      return;
    }

    setGreeting(built);
    setShowWelcome(true);
    markGreetingPresented(userId, storage, { spoken: false });
    setPendingSpeechText(built.spokenText);

    if (!canUseSpeechSynthesis()) {
      setSpeechBlocked(true);
      return;
    }

    // One auto-speak attempt per user per JS session (survives Strict Mode remount).
    if (hasAutoSpeakAttempted(userId)) {
      setSpeechBlocked(true);
      return;
    }
    markAutoSpeakAttempted(userId);

    (async () => {
      setAgentState('speaking');
      const outcome = await speakNexoraReliable(built.spokenText, {
        preferMale: true,
        onStart: () => setAgentState('speaking'),
        onEnd: () => setAgentState('idle'),
        onError: () => setAgentState('idle'),
      });

      if (outcome.status === 'started') {
        markGreetingSpoken(userId, storage);
        setSpeechBlocked(false);
        setPendingSpeechText(null);
        window.setTimeout(() => {
          setAgentState((s) => (s === 'speaking' ? 'idle' : s));
        }, 8000);
      } else {
        // blocked | unsupported | error | empty — never pretend we spoke
        setSpeechBlocked(outcome.status !== 'empty');
        setAgentState('idle');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- greet once when auth+workspace ready
  }, [ready, userId, workspaceLoading]);

  const enableVoice = useCallback(async () => {
    const text = pendingSpeechText || greeting?.spokenText;
    if (!text || !userId) return;
    setSpeechBlocked(false);
    setAgentState('speaking');
    const outcome = await enableAndSpeak(text, {
      preferMale: true,
      onStart: () => setAgentState('speaking'),
      onEnd: () => setAgentState('idle'),
      onError: () => setAgentState('idle'),
    });
    if (outcome.status === 'started') {
      markGreetingSpoken(userId, sessionStorageOrNull());
      setPendingSpeechText(null);
      setSpeechBlocked(false);
    } else {
      setSpeechBlocked(true);
      setAgentState('idle');
    }
  }, [pendingSpeechText, greeting, userId]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      window.sessionStorage.setItem(WELCOME_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const runSuggestion = useCallback(
    (prompt: string) => {
      setPendingJarvisPrompt(sessionStorageOrNull(), prompt);
      setShowWelcome(false);
      const href = chatResumeHref();
      if (typeof window !== 'undefined' && window.location.pathname.startsWith(APP_ROUTES.chat)) {
        window.dispatchEvent(new CustomEvent('nexora:jarvis-prompt', { detail: prompt }));
      } else {
        router.push(href);
      }
    },
    [router]
  );

  const value = useMemo<JarvisContextValue>(
    () => ({
      ready,
      userId,
      displayName,
      firstName: greeting?.firstName ?? null,
      greeting,
      showWelcome,
      speechBlocked,
      pendingSpeechText,
      agentState,
      setAgentState,
      enableVoice,
      dismissWelcome,
      runSuggestion,
    }),
    [
      ready,
      userId,
      displayName,
      greeting,
      showWelcome,
      speechBlocked,
      pendingSpeechText,
      agentState,
      enableVoice,
      dismissWelcome,
      runSuggestion,
    ]
  );

  return (
    <JarvisCtx.Provider value={value}>
      {children}
      {showWelcome && greeting ? (
        <JarvisWelcomePanel
          greeting={greeting}
          workspaceName={current?.name || null}
          agentState={agentState}
          speechBlocked={speechBlocked}
          onEnableVoice={enableVoice}
          onDismiss={dismissWelcome}
          onSuggestion={runSuggestion}
        />
      ) : null}
    </JarvisCtx.Provider>
  );
}

export function useJarvis(): JarvisContextValue | null {
  return useContext(JarvisCtx);
}

function JarvisWelcomePanel({
  greeting,
  workspaceName,
  agentState,
  speechBlocked,
  onEnableVoice,
  onDismiss,
  onSuggestion,
}: {
  greeting: BuiltGreeting;
  workspaceName: string | null;
  agentState: NexoraAgentState;
  speechBlocked: boolean;
  onEnableVoice: () => void;
  onDismiss: () => void;
  onSuggestion: (prompt: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[220] flex justify-center px-3 sm:bottom-8 sm:px-6 md:bottom-10">
      <div className="pointer-events-auto w-full max-w-xl rounded-[24px] border border-white/12 bg-[#0b0e16]/95 p-4 shadow-soft backdrop-blur-md sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <NexoraPresence state={agentState} />
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full px-2 py-1 text-[11px] uppercase tracking-wide text-neutral-500 hover:text-white"
          >
            Dismiss
          </button>
        </div>

        <h2 className="font-display mt-4 text-xl font-semibold text-white sm:text-2xl">{greeting.headline}</h2>
        <p className="mt-1 text-sm text-neutral-300">{greeting.subline}</p>
        {workspaceName ? (
          <p className="mt-2 text-xs text-neutral-500">
            Workspace · <span className="text-neutral-300">{workspaceName}</span>
          </p>
        ) : null}

        {speechBlocked ? (
          <button
            type="button"
            onClick={onEnableVoice}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-2 text-sm text-accent hover:bg-accent/20"
          >
            <Volume2 size={15} /> Enable Jarvis voice
          </button>
        ) : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {JARVIS_SUGGESTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSuggestion(s.prompt)}
              className={cn(
                'rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-left text-sm text-neutral-200 transition',
                'hover:border-accent/35 hover:bg-accent/10 hover:text-white'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Call on logout so the next login can greet again. */
export function resetJarvisSessionGuards() {
  stopNexoraSpeech();
  clearAutoSpeakAttempts();
  try {
    window.sessionStorage.removeItem(GREETING_SESSION_KEY);
    window.sessionStorage.removeItem(PENDING_PROMPT_KEY);
    window.sessionStorage.removeItem(WELCOME_DISMISSED_KEY);
  } catch {
    // ignore
  }
}
