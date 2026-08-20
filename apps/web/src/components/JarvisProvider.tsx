'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { type NexoraAgentState, canUseSpeechSynthesis } from '@/components/NexoraPresence';
import { JarvisLayer, type JarvisUiMode } from '@/components/JarvisLayer';
import {
  buildJarvisGreeting,
  shouldPresentGreeting,
  markGreetingPresented,
  markGreetingSpoken,
  readGreetingSession,
  hasAutoSpeakAttempted,
  markAutoSpeakAttempted,
  clearAutoSpeakAttempts,
  GREETING_SESSION_KEY,
  PENDING_PROMPT_KEY,
  type BuiltGreeting,
} from '@/lib/jarvisGreeting';
import {
  enableAndSpeak,
  interruptJarvisVoice,
  setJarvisVoiceMuted,
  isJarvisVoiceMuted,
  speakJarvis,
} from '@/lib/jarvisSpeech';
import { isEditableTarget, isJarvisToggleHotkey } from '@/lib/jarvisHotkeys';
import {
  buildConnectHints,
  buildContextualSuggestions,
  jarvisStatusLabel,
  jarvisToolNarration,
  type ConnectedTools,
} from '@/lib/jarvisStatus';
import { runJarvisTurn } from '@/lib/jarvisTurn';
import { isStopCommand, matchesWakePhrase, stripWakePhrase } from '@/lib/jarvisWake';
import { shouldAutoSpeakReply, humanToolResult } from '@/lib/humanizeTools';

const WELCOME_DISMISSED_KEY = 'nexora.jarvis.welcomeDismissed';
const WAKE_ENABLED_KEY = 'nexora.jarvis.wakeEnabled';

type MiniTurn = { role: 'user' | 'assistant'; content: string };

type JarvisContextValue = {
  ready: boolean;
  userId: string | null;
  displayName: string | null;
  firstName: string | null;
  greeting: BuiltGreeting | null;
  showWelcome: boolean;
  speechBlocked: boolean;
  pendingSpeechText: string | null;
  agentState: NexoraAgentState;
  setAgentState: (s: NexoraAgentState) => void;
  mode: JarvisUiMode;
  setMode: (m: JarvisUiMode) => void;
  statusLine: string;
  busy: boolean;
  voiceMuted: boolean;
  setVoiceMuted: (muted: boolean) => void;
  enableVoice: () => Promise<void>;
  dismissWelcome: () => void;
  runSuggestion: (prompt: string) => void;
  sendPrompt: (message: string) => Promise<void>;
  interruptSpeech: () => void;
  speakReply: (text: string) => Promise<void>;
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

function getSpeechRecognitionCtor(): any | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function JarvisProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { current, loading: workspaceLoading } = useWorkspaces();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<BuiltGreeting | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [speechBlocked, setSpeechBlocked] = useState(false);
  const [pendingSpeechText, setPendingSpeechText] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<NexoraAgentState>('idle');
  const [statusCustom, setStatusCustom] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<{ tool: string; action: string } | null>(null);
  const [mode, setMode] = useState<JarvisUiMode>('orb');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<MiniTurn[]>([]);
  const [micActive, setMicActive] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [voiceMuted, setVoiceMutedState] = useState(false);
  const [connected, setConnected] = useState<ConnectedTools | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const wakeRef = useRef<any>(null);
  const sendPromptRef = useRef<(message: string) => Promise<void>>(async () => undefined);
  const voiceMutedRef = useRef(false);
  voiceMutedRef.current = voiceMuted;

  const suggestions = useMemo(() => {
    const contextual = buildContextualSuggestions({ pathname, connected });
    const hints = buildConnectHints(connected);
    const merged = [...contextual];
    for (const h of hints) {
      if (!merged.some((m) => m.id === h.id)) merged.push(h);
    }
    return merged.slice(0, 4);
  }, [pathname, connected]);

  const statusLine = useMemo(
    () =>
      jarvisStatusLabel(agentState, {
        tool: activeTool?.tool,
        action: activeTool?.action,
        custom: statusCustom,
        muted: voiceMuted,
      }),
    [agentState, activeTool, statusCustom, voiceMuted]
  );

  const setVoiceMuted = useCallback((next: boolean) => {
    setVoiceMutedState(next);
    setJarvisVoiceMuted(next);
    try {
      window.sessionStorage.setItem('nexora.jarvis.voiceMuted', next ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setUserId(me.user.id);
        setDisplayName((me.user.displayName || me.user.email || '').trim() || null);
        setReady(true);
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    try {
      setWakeEnabled(window.sessionStorage.getItem(WAKE_ENABLED_KEY) === '1');
      const mutedPref = window.sessionStorage.getItem('nexora.jarvis.voiceMuted') === '1';
      setVoiceMutedState(mutedPref);
      setJarvisVoiceMuted(mutedPref);
    } catch {
      // ignore
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Load real integration connection status for honest suggestions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listIntegrations();
        if (cancelled) return;
        const tools = res.tools || [];
        const map: ConnectedTools = {};
        for (const t of tools) {
          const name = String(t.tool || '').toLowerCase();
          const active = String(t.status || '').toLowerCase() === 'active';
            if (name.includes('gmail')) map.gmail = active;
            if (name.includes('slack')) map.slack = active;
            if (name.includes('jira')) map.jira = active;
            if (name.includes('notion')) map.notion = active;
        }
        setConnected(map);
      } catch {
        if (!cancelled) setConnected(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const interruptSpeech = useCallback(() => {
    interruptJarvisVoice();
    setAgentState((s) => (s === 'speaking' ? 'idle' : s));
  }, []);

  const speakReply = useCallback(async (text: string) => {
    if (voiceMutedRef.current || isJarvisVoiceMuted() || !text.trim()) return;
    let toSpeak = text;
    if (!shouldAutoSpeakReply(text) && text.length > 420) {
      const lead = speakableLead(text);
      if (!lead) return;
      toSpeak = lead;
    }
    setAgentState('speaking');
    const outcome = await speakJarvis(toSpeak, {
      preferMale: true,
      rate: 0.9,
      interrupt: true,
      onStart: () => setAgentState('speaking'),
      onEnd: () => setAgentState('idle'),
      onError: () => setAgentState('idle'),
    });
    if (outcome.status === 'blocked') {
      setSpeechBlocked(true);
      setPendingSpeechText(toSpeak);
      setAgentState('idle');
    } else if (outcome.status !== 'completed' && outcome.status !== 'interrupted') {
      setAgentState('idle');
    }
  }, []);

  const sendPrompt = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || busy) return;

      // Interrupt any current speech before a new turn
      interruptSpeech();

      if (isStopCommand(trimmed)) {
        abortRef.current?.abort();
        setBusy(false);
        setStatusCustom(null);
        setAgentState('idle');
        return;
      }

      if (mode === 'orb') setMode('expanded');

      setTurns((t) => [...t, { role: 'user', content: trimmed }]);
      setBusy(true);
      setAgentState('thinking');
      setStatusCustom('Understanding…');
      setActiveTool(null);

      const controller = new AbortController();
      abortRef.current = controller;
      let assistantBuffer = '';

      try {
        const { result, conversationId } = await runJarvisTurn(trimmed, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'status') {
              setStatusCustom(event.message);
              setAgentState('thinking');
            }
            if (event.type === 'token') {
              assistantBuffer += event.text;
              setTurns((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + event.text };
                } else {
                  next.push({ role: 'assistant', content: event.text });
                }
                return next;
              });
            }
            if (event.type === 'tool_start') {
              setActiveTool({ tool: event.tool, action: event.action });
              setStatusCustom(jarvisToolNarration(event.tool, event.action));
              setAgentState('tool');
              // UI-only status — do NOT speak tool narration (it was canceling full replies mid-sentence).
            }
            if (event.type === 'tool_result') {
              setStatusCustom(humanToolResult(event.tool, event.action, event.ok, event.error));
              setAgentState(event.ok ? 'success' : 'error');
            }
            if (event.type === 'error') {
              setStatusCustom(event.message);
              setAgentState('error');
            }
            if (event.type === 'done') {
              const reply = event.result.reply || assistantBuffer;
              setTurns((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: reply || last.content };
                } else if (reply) {
                  next.push({ role: 'assistant', content: reply });
                }
                return next;
              });
              if (reply) void speakReply(reply);
              else setAgentState('idle');
            }
            if (event.type === 'conversation' || (event.type === 'done' && event.result.conversationId)) {
              const id =
                event.type === 'conversation' ? event.conversationId : event.result.conversationId;
              window.dispatchEvent(
                new CustomEvent('nexora:jarvis-turn', {
                  detail: { conversationId: id, message: trimmed },
                })
              );
            }
          },
        });

        // Avoid double-speak: stream `done` already called speakReply when tokens/reply arrived.
        if (result?.reply && !assistantBuffer) {
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') return prev;
            return [...prev, { role: 'assistant', content: result.reply }];
          });
        }

        if (conversationId) {
          window.dispatchEvent(
            new CustomEvent('nexora:jarvis-turn', {
              detail: { conversationId, message: trimmed },
            })
          );
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setStatusCustom((err as Error).message || 'Request failed');
          setAgentState('error');
        }
      } finally {
        setBusy(false);
        setStatusCustom(null);
        abortRef.current = null;
        setAgentState((s) => (s === 'speaking' ? s : s === 'error' ? s : 'idle'));
      }
    },
    [busy, interruptSpeech, mode, speakReply]
  );
  sendPromptRef.current = sendPrompt;

  // Greeting once per session — expands Jarvis, speech owned by shell (survives navigation)
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
      if (!rec || rec.userId !== userId || !rec.presented || dismissed) return;
      setGreeting(built);
      setShowWelcome(true);
      setMode('expanded');
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
    setMode('expanded');
    markGreetingPresented(userId, storage, { spoken: false });
    setPendingSpeechText(built.spokenText);

    if (!canUseSpeechSynthesis()) {
      setSpeechBlocked(true);
      return;
    }

    if (hasAutoSpeakAttempted(userId)) {
      setSpeechBlocked(true);
      return;
    }
    markAutoSpeakAttempted(userId);

    (async () => {
      setAgentState('speaking');
      const outcome = await speakJarvis(built.spokenText, {
        preferMale: true,
        rate: 0.9,
        interrupt: true,
        onStart: () => {
          setAgentState('speaking');
          // Mark spoken once audio actually begins (session guard) — not merely on text create
          markGreetingSpoken(userId, storage);
          setSpeechBlocked(false);
          setPendingSpeechText(null);
        },
        onEnd: () => setAgentState('idle'),
        onError: () => setAgentState('idle'),
      });

      if (outcome.status === 'completed') {
        // already marked on start
      } else if (outcome.status === 'interrupted') {
        setAgentState('idle');
      } else {
        setSpeechBlocked(outcome.status !== 'empty' && outcome.status !== 'muted');
        setAgentState('idle');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId, workspaceLoading]);

  const enableVoice = useCallback(async () => {
    const text = pendingSpeechText || greeting?.spokenText;
    if (!text || !userId) return;
    setSpeechBlocked(false);
    setAgentState('speaking');
    const outcome = await enableAndSpeak(text, {
      preferMale: true,
      rate: 0.9,
      onStart: () => setAgentState('speaking'),
      onEnd: () => setAgentState('idle'),
      onError: () => setAgentState('idle'),
    });
    if (outcome.status === 'completed' || outcome.status === 'started') {
      markGreetingSpoken(userId, sessionStorageOrNull());
      setPendingSpeechText(null);
      setSpeechBlocked(false);
    } else if (outcome.status !== 'interrupted') {
      setSpeechBlocked(true);
      setAgentState('idle');
    }
  }, [pendingSpeechText, greeting, userId]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    setMode('orb');
    try {
      window.sessionStorage.setItem(WELCOME_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const runSuggestion = useCallback(
    (prompt: string) => {
      setShowWelcome(false);
      void sendPromptRef.current(prompt);
    },
    []
  );

  const stopMic = useCallback(() => {
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    setMicActive(false);
    setAgentState((s) => (s === 'listening' ? 'idle' : s));
  }, []);

  const toggleMic = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatusCustom('Voice input is not supported in this browser.');
      return;
    }
    if (micActive) {
      stopMic();
      return;
    }
    interruptSpeech();
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-IN' : 'en-IN';
    recognition.onstart = () => {
      setMicActive(true);
      setAgentState('listening');
      setMode((m) => (m === 'orb' ? 'voice' : m));
      setStatusCustom('Listening…');
    };
    recognition.onerror = () => {
      setMicActive(false);
      setAgentState('idle');
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setMicActive(false);
      recognitionRef.current = null;
      setAgentState((s) => (s === 'listening' ? 'idle' : s));
    };
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0]?.transcript || '';
      }
      transcript = transcript.trim();
      if (!transcript) return;
      const final = event.results[event.results.length - 1]?.isFinal;
      if (final) {
        if (isStopCommand(transcript)) {
          interruptSpeech();
          abortRef.current?.abort();
          setAgentState('idle');
          return;
        }
        const command = stripWakePhrase(transcript) || transcript;
        void sendPromptRef.current(command);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setMicActive(false);
      setStatusCustom('Could not start microphone. Check browser permission.');
    }
  }, [interruptSpeech, micActive, stopMic]);

  const toggleWake = useCallback(() => {
    setWakeEnabled((prev) => {
      const next = !prev;
      try {
        window.sessionStorage.setItem(WAKE_ENABLED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      if (!next) {
        try {
          wakeRef.current?.stop?.();
        } catch {
          // ignore
        }
        wakeRef.current = null;
      }
      return next;
    });
  }, []);

  // Wake phrase — only when explicitly enabled; continuous listen with user consent
  useEffect(() => {
    if (!wakeEnabled) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    let stopped = false;
    const startWake = () => {
      if (stopped || micActive || busy) return;
      try {
        wakeRef.current?.stop?.();
      } catch {
        // ignore
      }
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-IN' : 'en-IN';
      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0]?.transcript || '';
        }
        const final = event.results[event.results.length - 1]?.isFinal;
        if (!final) return;
        if (!matchesWakePhrase(transcript)) return;
        const command = stripWakePhrase(transcript);
        setMode('voice');
        setAgentState('listening');
        if (command) {
          void sendPromptRef.current(command);
        } else {
          toggleMic();
        }
      };
      rec.onend = () => {
        if (!stopped && wakeEnabled) window.setTimeout(startWake, 400);
      };
      rec.onerror = () => {
        if (!stopped && wakeEnabled) window.setTimeout(startWake, 1200);
      };
      wakeRef.current = rec;
      try {
        rec.start();
      } catch {
        // permission or busy
      }
    };

    startWake();
    return () => {
      stopped = true;
      try {
        wakeRef.current?.stop?.();
      } catch {
        // ignore
      }
      wakeRef.current = null;
    };
  }, [wakeEnabled, micActive, busy, toggleMic]);

  // Global hotkey ⌘/Ctrl+J
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isJarvisToggleHotkey(e)) return;
      if (isEditableTarget(e.target) && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setMode((m) => (m === 'orb' ? 'expanded' : 'orb'));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Chat page can ask Jarvis to speak without owning TTS lifecycle
  useEffect(() => {
    function onChatSpeak(e: Event) {
      const text = String((e as CustomEvent<string>).detail || '');
      if (text) void speakReply(text);
    }
    function onChatState(e: Event) {
      const s = (e as CustomEvent<NexoraAgentState>).detail;
      if (s) setAgentState(s);
    }
    window.addEventListener('nexora:jarvis-speak', onChatSpeak as EventListener);
    window.addEventListener('nexora:jarvis-state', onChatState as EventListener);
    return () => {
      window.removeEventListener('nexora:jarvis-speak', onChatSpeak as EventListener);
      window.removeEventListener('nexora:jarvis-state', onChatState as EventListener);
    };
  }, [speakReply]);

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
      mode,
      setMode,
      statusLine,
      busy,
      voiceMuted,
      setVoiceMuted,
      enableVoice,
      dismissWelcome,
      runSuggestion,
      sendPrompt,
      interruptSpeech,
      speakReply,
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
      mode,
      statusLine,
      busy,
      voiceMuted,
      setVoiceMuted,
      enableVoice,
      dismissWelcome,
      runSuggestion,
      sendPrompt,
      interruptSpeech,
      speakReply,
    ]
  );

  return (
    <JarvisCtx.Provider value={value}>
      {children}
      <JarvisLayer
        mode={showWelcome && mode === 'orb' ? 'expanded' : mode}
        agentState={agentState}
        statusLine={statusLine}
        greeting={greeting}
        suggestions={suggestions}
        speechBlocked={speechBlocked}
        wakeEnabled={wakeEnabled}
        micActive={micActive}
        busy={busy}
        turns={turns}
        onSetMode={(m) => {
          setMode(m);
          if (m === 'orb') {
            setShowWelcome(false);
            try {
              window.sessionStorage.setItem(WELCOME_DISMISSED_KEY, '1');
            } catch {
              // ignore
            }
          }
        }}
        onEnableVoice={() => void enableVoice()}
        onToggleMic={toggleMic}
        voiceMuted={voiceMuted}
        onToggleMute={() => setVoiceMuted(!voiceMuted)}
        onInterrupt={interruptSpeech}
        onSend={(t) => void sendPrompt(t)}
        onSuggestion={runSuggestion}
        onToggleWake={toggleWake}
      />
    </JarvisCtx.Provider>
  );
}

function speakableLead(text: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  const sentence = plain.split(/(?<=[.!?])\s+/)[0];
  return (sentence || plain).slice(0, 180);
}

export function useJarvis(): JarvisContextValue | null {
  return useContext(JarvisCtx);
}

/** Call on logout so the next login can greet again. */
export function resetJarvisSessionGuards() {
  interruptJarvisVoice();
  clearAutoSpeakAttempts();
  try {
    window.sessionStorage.removeItem(GREETING_SESSION_KEY);
    window.sessionStorage.removeItem(PENDING_PROMPT_KEY);
    window.sessionStorage.removeItem(WELCOME_DISMISSED_KEY);
    window.sessionStorage.removeItem(WAKE_ENABLED_KEY);
    window.sessionStorage.removeItem('nexora.jarvis.voiceMuted');
  } catch {
    // ignore
  }
}
