'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ExternalLink,
  Check,
  Copy,
  FileUp,
  Mic,
  Quote,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Terminal,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react';
import { api, type AgentTurnResult } from '@/lib/api';
import { outcomesFromTurn, openLabelFor } from '@/lib/actionOutcomes';
import { humanToolStart, humanToolResult, shouldAutoSpeakReply } from '@/lib/humanizeTools';
import { GlassCard, Reveal } from '@/components/motion';
import { MarkdownLite } from '@/components/MarkdownLite';
import { RiskRadial } from '@/components/charts';
import { cn } from '@/lib/utils';
import { APP_ROUTES, chatConversationPath } from '@/lib/routes';
import { writeActiveConversationHint, resolveResumeConversationId } from '@/lib/activeConversation';
import {
  NexoraPresence,
  type NexoraAgentState,
  speakNexora,
  stopNexoraSpeech,
  canUseSpeechSynthesis,
} from '@/components/NexoraPresence';

const riskScore: Record<string, number> = { low: 24, medium: 58, high: 88 };
const riskColor: Record<string, string> = { low: '#8be9d0', medium: '#f5b95d', high: '#fb7185' };

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  detail?: AgentTurnResult;
  messageId?: string;
}

const SUGGESTIONS = [
  'Find my top priority emails',
  'Show my unread emails',
  'Create a launch war room for Project Atlas on slack',
  'Create a Notion page named Investor Notes',
];

const riskBadgeClasses: Record<string, string> = {
  low: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
  medium: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
  high: 'bg-rose-500/12 text-rose-300 border-rose-500/25',
};

const MAX_CLIENT_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_CLIENT_EXT = /\.(pdf|docx|txt|md|markdown|csv|tsv|json|xlsx|xls|png|jpe?g|webp|gif|ts|tsx|js|jsx|py|sql|html|css|ya?ml)$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MicState = 'idle' | 'listening' | 'unsupported' | 'denied' | 'error';

function mapMessagesToTurns(messages: any[]): Turn[] {
  return (messages || []).map((m: any) => {
    const stored = m.tool_calls;
    const detail: AgentTurnResult | undefined =
      stored && typeof stored === 'object' && stored.plan
        ? {
            reply: m.content,
            plan: stored.plan,
            executedCalls: Array.isArray(stored.executedCalls) ? stored.executedCalls : [],
            pendingApprovalIds: Array.isArray(stored.pendingApprovalIds)
              ? stored.pendingApprovalIds
              : [],
          }
        : undefined;
    return {
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date(m.created_at).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
      detail,
      messageId: m.id,
    };
  });
}

export function ChatWorkspace({ routeConversationId }: { routeConversationId?: string }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Always hydrate on mount so bare /app/chat never flashes a blank "new chat"
  // before server resume redirects to the real conversation.
  const [hydrating, setHydrating] = useState(true);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [conversationId, setConversationIdState] = useState<string | undefined>(
    routeConversationId && UUID_RE.test(routeConversationId) ? routeConversationId : undefined
  );
  const [history, setHistory] = useState<{ id: string; title: string; pinned?: boolean }[]>([]);
  const [approvingTurn, setApprovingTurn] = useState<number | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{ id: string; filename: string; hasText: boolean; error?: string; uploading?: boolean }>
  >([]);
  const [uploading, setUploading] = useState(false);
  const [micState, setMicState] = useState<MicState>('idle');
  const [micHint, setMicHint] = useState<string | null>(null);
  const [userFirstName, setUserFirstName] = useState<string | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [agentState, setAgentState] = useState<NexoraAgentState>('idle');
  const voiceMutedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string>('');
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef('');
  const voiceSessionRef = useRef({
    active: false,
    baseInput: '',
    finalCommitted: false,
  });
  const loadedIdRef = useRef<string | undefined>(undefined);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  voiceMutedRef.current = voiceMuted;
  inputRef.current = input;

  function resetVoiceSession() {
    voiceSessionRef.current = { active: false, baseInput: '', finalCommitted: false };
  }

  function beginVoiceSession() {
    voiceSessionRef.current = {
      active: true,
      baseInput: inputRef.current.trim(),
      finalCommitted: false,
    };
  }

  function updateInterimPreview(interim: string) {
    const session = voiceSessionRef.current;
    if (!session.active || session.finalCommitted) return;
    const piece = interim.trim();
    if (!piece) {
      setInput(session.baseInput);
      return;
    }
    setInput(session.baseInput ? `${session.baseInput} ${piece}` : piece);
  }

  function commitFinalTranscript(finalText: string) {
    const session = voiceSessionRef.current;
    if (!session.active || session.finalCommitted) return;
    const piece = finalText.trim();
    if (!piece) return;
    session.finalCommitted = true;
    const next = session.baseInput ? `${session.baseInput} ${piece}` : piece;
    setInput(next);
    inputRef.current = next;
  }

  useEffect(() => {
    setTtsSupported(canUseSpeechSynthesis());
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (cancelled) return;
        const raw = (res.user.displayName || '').trim();
        const first = raw.split(/\s+/)[0] || null;
        setUserFirstName(first && first.length > 1 ? first : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function setConversationId(id: string | undefined) {
    setConversationIdState(id);
    writeActiveConversationHint(id);
    if (!id) {
      if (routeConversationId) router.replace(APP_ROUTES.chat);
      return;
    }
    const target = chatConversationPath(id);
    if (typeof window === 'undefined') return;
    // Always update Next.js App Router. ChatWorkspace lives in chat/layout.tsx so
    // this replace does NOT remount us / wipe the transcript.
    if (window.location.pathname !== target) {
      router.replace(target);
    }
  }

  async function refreshHistory() {
    try {
      const res = await api.listConversations();
      setHistory(res.conversations || []);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHydrating(true);
      let listed: { id: string; title: string; pinned?: boolean }[] = [];
      try {
        const res = await api.listConversations();
        listed = res.conversations || [];
        if (!cancelled) setHistory(listed);
      } catch {
        // ignore
      }
      if (cancelled) return;

      const resumeId =
        routeConversationId && UUID_RE.test(routeConversationId)
          ? routeConversationId
          : undefined;

      if (resumeId) {
        // Already hydrated this conversation in-memory (first-message / New Chat → URL update).
        if (loadedIdRef.current === resumeId && turnsRef.current.length > 0) {
          setConversationIdState(resumeId);
          writeActiveConversationHint(resumeId);
          setHydrating(false);
          return;
        }
        const loadOnce = async () => {
          const data = await api.getConversation(resumeId);
          if (cancelled) return false;
          setConversationIdState(resumeId);
          writeActiveConversationHint(resumeId);
          loadedIdRef.current = resumeId;
          setTurns(mapMessagesToTurns(data.messages || []));
          setError(null);
          return true;
        };
        try {
          if (await loadOnce()) {
            if (!cancelled) setHydrating(false);
            return;
          }
        } catch (firstErr) {
          if (cancelled) return;
          // Transient auth/network blip — retry once before treating as missing.
          try {
            await new Promise((r) => setTimeout(r, 400));
            if (cancelled) return;
            if (await loadOnce()) {
              if (!cancelled) setHydrating(false);
              return;
            }
          } catch (secondErr) {
            if (cancelled) return;
            const msg = String((secondErr as Error)?.message || (firstErr as Error)?.message || '');
            const isMissing = /not found|404|inaccessible/i.test(msg);
            loadedIdRef.current = undefined;
            if (isMissing) {
              // Confirmed missing — try a different owned conversation. NEVER wipe to blank
              // when resume still points at the same id (that caused blank-chat-with-History).
              writeActiveConversationHint(undefined);
              try {
                const fallback = await resolveResumeConversationId();
                if (!cancelled && fallback && fallback !== resumeId) {
                  router.replace(chatConversationPath(fallback));
                  return;
                }
              } catch {
                // ignore
              }
              setError('Conversation not found or inaccessible.');
              setTurns([]);
              if (!cancelled) setHydrating(false);
              return;
            }
            // Non-404: keep URL + hint; show error — do not open a blank chat.
            setError(msg || 'Could not load conversation. Retrying may help.');
            if (!cancelled) setHydrating(false);
            return;
          }
        }
        return;
      }

      // Bare /app/chat: DB resume is authoritative. Never create a conversation here.
      // Never show blank "new chat" when the user already has conversations in History.
      try {
        let serverId = await resolveResumeConversationId();
        if (!serverId) {
          const first = listed[0]?.id;
          if (typeof first === 'string' && UUID_RE.test(first)) serverId = first;
        }
        if (cancelled) return;
        if (serverId) {
          writeActiveConversationHint(serverId);
          router.replace(chatConversationPath(serverId));
          // Keep hydrating=true until the id-route effect loads messages.
          return;
        }
      } catch {
        // ignore — show empty only when no owned conversations exist
      }

      if (!cancelled) {
        loadedIdRef.current = undefined;
        setConversationIdState(undefined);
        setTurns([]);
        setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeConversationId]);

  // Keep resume hint fresh while this workspace is mounted.
  useEffect(() => {
    if (conversationId) writeActiveConversationHint(conversationId);
  }, [conversationId]);

  async function approveAndRunFromChat(turnIndex: number, ids: string[]) {
    if (!ids.length || approvingTurn !== null) return;
    setApprovingTurn(turnIndex);
    setError(null);
    try {
      const results: string[] = [];
      const succeeded: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        const res = await api.decideApproval(id, 'approved');
        const out = res.executionResult;
        // Never treat mock / unverified as success
        if (out?.ok && !out.mocked) {
          succeeded.push(id);
          const o = (out.output || {}) as Record<string, unknown>;
          const key = o.key || o.id || o.ts;
          const url = o.url;
          const label = `${res.approval.tool}.${res.approval.action}`;
          if (key && url) results.push(`✓ ${label} → **${key}** — ${url}`);
          else if (key) results.push(`✓ ${label} → **${key}**`);
          else results.push(`✓ ${label} completed (verified)`);
        } else {
          failed.push(id);
          results.push(
            `✗ ${res.approval?.tool || 'tool'}.${res.approval?.action || 'action'}: ${
              out?.error || (out?.mocked ? 'Mock result rejected — connect live integration.' : `Failed to run approval ${id}`)
            }`
          );
        }
      }
      // Reload durable server history (execution result is persisted by the API)
      if (conversationId) {
        const data = await api.getConversation(conversationId);
        setTurns(mapMessagesToTurns(data.messages || []));
      } else {
        const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        setTurns((prev) => {
          const next = [...prev];
          const turn = next[turnIndex];
          if (turn?.detail) {
            const remaining = (turn.detail.pendingApprovalIds || []).filter((pid) => !succeeded.includes(pid));
            next[turnIndex] = {
              ...turn,
              detail: { ...turn.detail, pendingApprovalIds: remaining },
            };
          }
          const summary =
            failed.length && succeeded.length
              ? `Partially completed (${succeeded.length} ok, ${failed.length} failed):\n${results.join('\n')}`
              : results.join('\n') || 'Approved and executed.';
          next.push({ role: 'assistant', content: summary, timestamp: now });
          return next;
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingTurn(null);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns.length, loading]);

  async function loadConversation(id: string) {
    router.push(chatConversationPath(id));
  }

  async function send(message: string, opts?: { regenerate?: boolean }) {
    const trimmed = message.trim();
    const readyAttachments = pendingAttachments.filter((a) => !a.uploading);
    if ((!trimmed && readyAttachments.length === 0) || loading) return;
    if (pendingAttachments.some((a) => a.uploading)) {
      setError('Wait for uploads to finish before sending.');
      return;
    }
    const payload =
      trimmed ||
      (readyAttachments.length
        ? `Please analyze the attached file${readyAttachments.length > 1 ? 's' : ''}: ${readyAttachments
            .map((a) => a.filename)
            .join(', ')}.`
        : '');
    if (!payload) return;

    stopListening();

    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setInput('');
    setError(null);
    setStatusLine('Understanding request…');
    setAgentState('thinking');
    lastUserMessageRef.current = payload;
    if (!opts?.regenerate) {
      setTurns((t) => [...t, { role: 'user', content: payload, timestamp: now }]);
    }
    setLoading(true);

    const attachmentIds = readyAttachments.map((a) => a.id);
    setPendingAttachments([]);

    // Placeholder assistant turn for streaming tokens
    setTurns((t) => [...t, { role: 'assistant', content: '', timestamp: now }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Create + bind conversation BEFORE streaming so URL is canonical and Approvals can link.
      // Layout-owned ChatWorkspace survives router.replace — no mid-stream remount wipe.
      let activeId = conversationId;
      if (!activeId) {
        const created = await api.createConversation(payload.slice(0, 80));
        activeId = created.conversation.id;
        loadedIdRef.current = activeId;
        setConversationId(activeId);
      }

      const result = await api.streamMessage(payload, {
        conversationId: activeId,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'status') {
            setStatusLine(event.message);
            setAgentState('thinking');
          }
          if (event.type === 'token') {
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') {
                next[next.length - 1] = { ...last, content: last.content + event.text };
              }
              return next;
            });
          }
          if (event.type === 'tool_start') {
            setStatusLine(humanToolStart(event.tool, event.action));
            setAgentState('tool');
          }
          if (event.type === 'tool_result') {
            setStatusLine(humanToolResult(event.tool, event.action, event.ok, event.error));
            setAgentState(event.ok ? 'success' : 'error');
          }
          if (event.type === 'approval') {
            setStatusLine('Action ready for your approval.');
          }
          if (event.type === 'error') {
            setError(event.message);
            setAgentState('error');
          }
          if (event.type === 'conversation') {
            loadedIdRef.current = event.conversationId;
            setConversationId(event.conversationId);
          }
          if (event.type === 'done') {
            const reply = event.result.reply || '';
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') {
                next[next.length - 1] = {
                  ...last,
                  content: reply || last.content,
                  detail: event.result,
                };
              }
              return next;
            });
            if (event.result.conversationId) {
              loadedIdRef.current = event.result.conversationId;
              setConversationId(event.result.conversationId);
            }
            if (reply && shouldAutoSpeakReply(reply)) {
              const hasWork =
                (event.result.executedCalls?.some((c) => c.ok && !c.mocked) ?? false) ||
                (event.result.pendingApprovalIds?.length ?? 0) > 0;
              if (hasWork) {
                speakNexora(reply, {
                  muted: voiceMutedRef.current,
                  onStart: () => setAgentState('speaking'),
                  onEnd: () => setAgentState('idle'),
                  onError: () => setAgentState('idle'),
                });
              } else {
                setAgentState('idle');
              }
            } else {
              setAgentState('idle');
            }
          }
        },
      });
      if (result?.conversationId) {
        loadedIdRef.current = result.conversationId;
        setConversationId(result.conversationId);
      }
      refreshHistory();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatusLine('Stopped');
      } else {
        setError((err as Error).message);
        // Remove empty assistant placeholder on hard failure
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && !last.content) return prev.slice(0, -1);
          return prev;
        });
      }
    } finally {
      setLoading(false);
      setStatusLine(null);
      abortRef.current = null;
      setAgentState((s) => (s === 'speaking' ? s : 'idle'));
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function regenerateLast() {
    const msg = lastUserMessageRef.current;
    if (!msg || loading) return;
    // Drop last assistant turn then resend
    setTurns((prev) => {
      if (prev.length && prev[prev.length - 1]?.role === 'assistant') return prev.slice(0, -1);
      return prev;
    });
    await send(msg, { regenerate: true });
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_CLIENT_UPLOAD_BYTES) {
      setError(`File too large. Max ${Math.round(MAX_CLIENT_UPLOAD_BYTES / (1024 * 1024))}MB.`);
      return;
    }
    if (!ALLOWED_CLIENT_EXT.test(file.name)) {
      setError('File type not allowed. Use PDF, DOCX, TXT, CSV, JSON, XLSX, images, or common code files.');
      return;
    }
    // Duplicate name in pending — allow but warn
    if (pendingAttachments.some((a) => a.filename === file.name && !a.uploading)) {
      setError(`“${file.name}” is already attached. Remove it first or pick another file.`);
      return;
    }

    const tempId = `uploading-${Date.now()}`;
    setUploading(true);
    setError(null);
    setPendingAttachments((a) => [
      ...a,
      { id: tempId, filename: file.name, hasText: false, uploading: true },
    ]);
    try {
      const attachment = await api.uploadChatFile(file);
      setPendingAttachments((list) =>
        list.map((item) =>
          item.id === tempId
            ? {
                id: attachment.id,
                filename: attachment.filename,
                hasText: attachment.hasText,
                error: attachment.error,
                uploading: false,
              }
            : item
        )
      );
      if (attachment.error || !attachment.hasText) {
        setError(attachment.error || 'File uploaded but no text could be extracted.');
      }
    } catch (err) {
      setPendingAttachments((list) => list.filter((item) => item.id !== tempId));
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function getSpeechRecognitionCtor(): any | null {
    if (typeof window === 'undefined') return null;
    const w = window as any;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  function stopListening() {
    try {
      recognitionRef.current?.abort?.();
    } catch {
      // ignore
    }
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    resetVoiceSession();
    setMicState('idle');
    setAgentState((s) => (s === 'listening' ? 'idle' : s));
  }

  function toggleMicrophone() {
    setMicHint(null);
    setError(null);
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setMicState('unsupported');
      setMicHint('Voice input is not supported in this browser. Try Chrome or Edge, or type your message.');
      return;
    }
    if (micState === 'listening' || voiceSessionRef.current.active) {
      stopListening();
      return;
    }

    stopListening();
    beginVoiceSession();

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';

    recognition.onstart = () => {
      setMicState('listening');
      setAgentState('listening');
    };
    recognition.onerror = (event: any) => {
      const code = String(event?.error || '');
      if (code === 'aborted') return;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setMicState('denied');
        setMicHint('Microphone permission is required for voice input. Allow mic access and retry.');
      } else if (code === 'no-speech') {
        setMicState('idle');
        setMicHint('No speech detected. Click the mic and try again.');
      } else {
        setMicState('error');
        setMicHint(`Voice input failed: ${code || 'unknown error'}`);
      }
      recognitionRef.current = null;
      resetVoiceSession();
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      resetVoiceSession();
      setMicState('idle');
      setAgentState((s) => (s === 'listening' ? 'idle' : s));
    };
    recognition.onresult = (event: any) => {
      if (!voiceSessionRef.current.active || voiceSessionRef.current.finalCommitted) return;

      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalChunk += transcript;
        else interim += transcript;
      }

      if (finalChunk.trim()) {
        commitFinalTranscript(finalChunk);
        return;
      }
      if (interim.trim()) {
        updateInterimPreview(interim);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      setMicState('error');
      setMicHint(err instanceof Error ? err.message : 'Could not start microphone.');
      recognitionRef.current = null;
      resetVoiceSession();
    }
  }

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }
      stopNexoraSpeech();
    };
  }, []);

  async function copyAssistantMessage(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1800);
    } catch {
      setCopiedIndex(null);
    }
  }

  async function startNewChat() {
    setError(null);
    setPendingAttachments([]);
    lastUserMessageRef.current = '';
    setHydrating(true);
    try {
      // Explicit New Chat is the ONLY navigation path that creates a conversation.
      const created = await api.createConversation('New conversation');
      const id = created.conversation.id;
      loadedIdRef.current = id;
      setTurns([]);
      writeActiveConversationHint(id);
      setConversationIdState(id);
      router.replace(chatConversationPath(id));
    } catch (err) {
      setError((err as Error).message || 'Could not start a new chat.');
      setHydrating(false);
    }
  }

  async function deleteConversation(id: string) {
    await api.deleteConversation(id);
    if (conversationId === id) startNewChat();
    refreshHistory();
  }

  return (
    <div className="app-page space-y-4 sm:space-y-6">
      <Reveal>
        <GlassCard variant="glow" className="p-4 sm:p-7" hoverLift={false}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 max-w-2xl">
              <div className="flex flex-wrap items-center gap-3">
                <NexoraPresence
                  state={
                    micState === 'listening'
                      ? 'listening'
                      : loading
                        ? agentState === 'idle'
                          ? 'thinking'
                          : agentState
                        : agentState
                  }
                />
                <span className="badge border-white/10 bg-white/5 text-white">
                  <Sparkles size={12} className="text-accent2" /> Agent core
                </span>
              </div>
              <h1 className="font-display mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">
                {userFirstName ? (
                  <>
                    Hi {userFirstName}, I&apos;m <span className="gradient-text">Nexora</span>
                  </>
                ) : (
                  <>
                    Hi, I&apos;m <span className="gradient-text">Nexora</span>
                  </>
                )}
              </h1>
              <p className="mt-2 text-sm leading-6 text-neutral-400 sm:leading-7">
                How can I assist you today? I use your connected Gmail, Slack, Notion, and Jira — with approvals for
                consequential actions.
              </p>
            </div>

            <div className="hidden w-full max-w-sm rounded-[24px] border border-white/10 bg-black/25 p-5 sm:block">
              <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Live system state</div>
              <div className="mt-2 text-sm text-neutral-400">Secure reasoning · tool orchestration · human approval</div>
              <div className="mt-4 grid gap-2 text-sm text-neutral-300">
                {['Interactive agent session ready', 'Hybrid context store synced', 'Action approvals online'].map((s) => (
                  <div key={s} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3.5 py-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </Reveal>

      <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)]">
        <GlassCard
          className="flex min-h-[min(70vh,640px)] flex-col p-3 sm:min-h-[560px] sm:p-6"
          hoverLift={false}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-5">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Agent session</div>
              <h2 className="font-display text-lg font-semibold text-white sm:text-xl">Conversation</h2>
            </div>
            <div className="flex items-center gap-2">
              {ttsSupported && (
                <>
                  <button
                    type="button"
                    title={voiceMuted ? 'Unmute voice replies' : 'Mute voice replies'}
                    onClick={() => {
                      const next = !voiceMuted;
                      setVoiceMuted(next);
                      if (next) {
                        stopNexoraSpeech();
                        setAgentState('idle');
                      }
                    }}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full border border-white/10 transition',
                      voiceMuted ? 'bg-white/5 text-neutral-500' : 'bg-accent/10 text-accent'
                    )}
                  >
                    {voiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                  {agentState === 'speaking' && (
                    <button
                      type="button"
                      title="Stop speaking"
                      onClick={() => {
                        stopNexoraSpeech();
                        setAgentState('idle');
                      }}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] uppercase tracking-wide text-neutral-300 hover:text-white"
                    >
                      Stop
                    </button>
                  )}
                </>
              )}
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-accent">
                Realtime
              </span>
            </div>
          </div>

          <div className="thin-scroll flex-1 space-y-4 overflow-y-auto pr-1">
            {hydrating ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-neutral-400">
                <RefreshCw size={18} className="animate-spin text-accent" />
                Loading conversation…
              </div>
            ) : (
              <>
            <AnimatePresence initial={false}>
              {turns.map((turn, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'group relative max-w-[92%] overflow-hidden rounded-[26px] border p-5',
                    turn.role === 'user'
                      ? 'ml-auto rounded-br-lg border-accent/25 bg-accent/10'
                      : 'mr-auto rounded-bl-lg border-white/12 bg-white/5'
                  )}
                >
                  <div className="mb-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', turn.role === 'user' ? 'bg-accent2' : 'bg-accent')} />
                      {turn.role === 'user' ? 'You' : 'Nexora'}
                    </div>
                    <span>{turn.timestamp}</span>
                  </div>

                  <div className="text-sm leading-7 text-neutral-100">
                    {turn.role === 'assistant' ? <MarkdownLite content={turn.content} /> : turn.content}
                  </div>

                  {turn.role === 'assistant' && turn.detail && (() => {
                    const outcomes =
                      turn.detail.actionOutcomes ||
                      outcomesFromTurn(
                        turn.detail.executedCalls,
                        turn.detail.pendingApprovalIds,
                        turn.detail.plan.toolCalls
                      );
                    const completed = outcomes.filter((o) => o.status === 'success');
                    if (!completed.length) return null;
                    return (
                      <div className="mt-4 space-y-2">
                        {completed.map((o, oi) => (
                          <div
                            key={oi}
                            className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-neutral-200"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                                  {o.integration}
                                </div>
                                <div className="mt-1 text-white">{o.summary}</div>
                                {o.resource && (
                                  <div className="mt-1 text-xs text-neutral-400">{o.resource}</div>
                                )}
                              </div>
                              {o.resourceUrl && (
                                <a
                                  href={o.resourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
                                >
                                  {openLabelFor(o.integration)}
                                  <ExternalLink size={12} />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {turn.role === 'assistant' && (
                    <button
                      type="button"
                      onClick={() => copyAssistantMessage(i, turn.content)}
                      className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/40 text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:text-white"
                    >
                      {copiedIndex === i ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  )}

                  {turn.detail && (
                    <div className="mt-5 space-y-4 border-t border-white/10 pt-4 text-sm text-neutral-400">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
                          Intent: {turn.detail.plan.intent.intent}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
                          Confidence: {Math.round(turn.detail.plan.intent.confidence * 100)}%
                        </span>
                      </div>
                      <div className="flex items-start gap-2 text-xs text-neutral-500">
                        <Quote size={12} className="mt-0.5 shrink-0" />
                        {turn.detail.plan.intent.rationale}
                      </div>

                      {turn.detail.plan.toolCalls.length > 0 && (
                        <div>
                          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white">
                            <Terminal size={12} /> Tool execution
                          </div>
                          <div className="grid gap-2.5">
                            {turn.detail.plan.toolCalls.map((c, j) => (
                              <div key={j} className="rounded-2xl border border-white/10 bg-black/25 p-3.5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="code text-xs text-white">
                                    {c.tool}.{c.action}
                                  </span>
                                  <span
                                    className={cn(
                                      'rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                      riskBadgeClasses[c.riskLevel] || riskBadgeClasses.low
                                    )}
                                  >
                                    {c.riskLevel}
                                  </span>
                                </div>
                                <div className="mt-1.5 text-[11px] text-neutral-500">
                                  {c.requiresApproval ? 'Awaiting approval' : 'Auto-executed'}
                                </div>
                              </div>
                            ))}
                          </div>
                          {turn.detail.pendingApprovalIds?.length > 0 && (() => {
                            const risky =
                              turn.detail.plan.toolCalls.find((c) => c.requiresApproval) ||
                              turn.detail.plan.toolCalls[0];
                            const level = risky?.riskLevel || 'high';
                            const score = riskScore[level] ?? 88;
                            const color = riskColor[level] ?? '#fb7185';
                            return (
                              <motion.div
                                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                                className="mt-4 overflow-hidden rounded-[22px] border border-rose-400/25 bg-gradient-to-br from-rose-500/10 via-black/40 to-amber-500/10 p-4"
                              >
                                <div className="grid gap-4 sm:grid-cols-[1fr_120px] sm:items-center">
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-200/90">
                                      Approval required · {level} risk
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-neutral-300">
                                      This action is paused for human review. Approve here to run the real connector
                                      operation, or open Approvals for the full intent and impact preview.
                                    </p>
                                    {turn.detail.plan.toolCalls
                                      .filter((c) => c.requiresApproval)
                                      .slice(0, 2)
                                      .map((c, pi) => (
                                        <div
                                          key={pi}
                                          className="mt-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-neutral-300"
                                        >
                                          <div className="font-semibold uppercase tracking-wide text-rose-100/90">
                                            {c.tool}.{c.action}
                                          </div>
                                          {c.input?._goal ? (
                                            <div className="mt-1">Goal: {String(c.input._goal)}</div>
                                          ) : null}
                                          {c.input?.summary || c.input?.title || c.input?.channel ? (
                                            <div className="mt-1 text-neutral-400">
                                              {c.input.summary
                                                ? `Summary: ${String(c.input.summary)}`
                                                : c.input.title
                                                  ? `Title: ${String(c.input.title)}`
                                                  : c.input.channel
                                                    ? `Channel: ${String(c.input.channel)}`
                                                    : null}
                                            </div>
                                          ) : null}
                                        </div>
                                      ))}
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <Link
                                        href={`${APP_ROUTES.approvals}?focus=${encodeURIComponent(
                                          (turn.detail.pendingApprovalIds || [])[0] || ''
                                        )}`}
                                        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-white/10"
                                      >
                                        View action plan
                                      </Link>
                                      <button
                                        type="button"
                                        disabled={approvingTurn === i}
                                        onClick={() =>
                                          approveAndRunFromChat(i, turn.detail!.pendingApprovalIds || [])
                                        }
                                        className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-[#04101f] transition hover:bg-[#7db6ff] disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <ShieldAlert size={12} />
                                        {approvingTurn === i
                                          ? 'Executing…'
                                          : `Approve & run (${turn.detail.pendingApprovalIds.length})`}
                                      </button>
                                      <Link
                                        href={APP_ROUTES.approvals}
                                        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-white/10"
                                      >
                                        Open Approvals
                                      </Link>
                                    </div>
                                  </div>
                                  <div className="relative mx-auto h-24 w-24">
                                    <RiskRadial value={score} color={color} />
                                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                      <span className="text-lg font-semibold text-white">{score}</span>
                                      <span className="text-[9px] uppercase tracking-wide text-neutral-500">risk</span>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {turns.length === 0 && (
              <div className="mx-auto w-full max-w-lg rounded-[28px] border border-white/10 bg-black/20 px-5 py-10 text-center sm:px-8 sm:py-14">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/5 text-accent2">
                  <Wand2 size={26} />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white sm:text-xl">
                  {userFirstName
                    ? `Hi ${userFirstName}, I'm Nexora.`
                    : "Hi, I'm Nexora."}
                </h3>
                <p className="text-sm leading-6 text-neutral-400">
                  How can I assist you today? Ask about your inbox, Slack, Notion, or Jira — I run real tools, never
                  demo data.
                </p>
              </div>
            )}
              </>
            )}

            {loading && (
              <div className="mr-auto flex max-w-[70%] items-center gap-2 rounded-[26px] border border-white/12 bg-white/5 px-5 py-3.5 text-sm text-neutral-300">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-dots rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-dots rounded-full bg-accent" style={{ animationDelay: '160ms' }} />
                  <span className="h-1.5 w-1.5 animate-dots rounded-full bg-accent" style={{ animationDelay: '320ms' }} />
                </span>
                {statusLine || 'thinking'}
              </div>
            )}
            {error && <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3.5 text-sm text-red-300">{error}</div>}
            <div ref={bottomRef} />
          </div>

          {pendingAttachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {pendingAttachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1 text-xs text-neutral-300"
                >
                  <FileUp size={12} className="text-neutral-500" />
                  {a.uploading ? (
                    <span className="text-neutral-400">Uploading {a.filename}…</span>
                  ) : (
                    <>
                      <span className={a.hasText ? 'text-emerald-300' : 'text-amber-300'}>
                        {a.hasText ? '✓' : '!'} {a.filename}
                      </span>
                    </>
                  )}
                  {!a.uploading && (
                    <button
                      type="button"
                      onClick={() => setPendingAttachments((list) => list.filter((x) => x.id !== a.id))}
                      className="text-neutral-500 hover:text-white"
                      title="Remove attachment"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {(micHint || micState === 'listening') && (
            <div className="mt-2 text-xs text-neutral-400">
              {micState === 'listening' ? 'Listening… speak now (click mic again to stop).' : micHint}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pendingAttachments.some((a) => a.uploading)) {
                setError('Wait for uploads to finish before sending.');
                return;
              }
              send(input);
            }}
            className="mt-4 flex flex-wrap items-center gap-2 rounded-[22px] border border-white/10 bg-black/25 p-2 pl-3 transition focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15 sm:mt-5 sm:flex-nowrap sm:rounded-[26px] sm:pl-4"
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.ts,.tsx,.js,.jsx,.py,.sql,.html,.css,.yaml,.yml,text/*,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              title="Attach a file"
              disabled={uploading || loading}
              onClick={() => fileRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              <FileUp size={16} />
            </button>
            <button
              type="button"
              title={micState === 'listening' ? 'Stop listening' : 'Voice input'}
              disabled={loading}
              onClick={toggleMicrophone}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-white/5 disabled:opacity-40',
                micState === 'listening' ? 'bg-rose-500/20 text-rose-300' : 'text-neutral-500 hover:text-white',
                (micState === 'denied' || micState === 'unsupported' || micState === 'error') && 'text-amber-300'
              )}
            >
              <Mic size={16} />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Nexora — emails, Slack, Notion, Jira…"
              className="min-h-[44px] min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500"
            />
            {loading ? (
              <button
                type="button"
                onClick={stopGeneration}
                title="Stop"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition hover:bg-white/10"
              >
                <Square size={14} />
              </button>
            ) : (
              <>
                {lastUserMessageRef.current && turns.length > 0 && (
                  <button
                    type="button"
                    title="Regenerate"
                    onClick={() => regenerateLast()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/5 hover:text-white"
                  >
                    <RefreshCw size={15} />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading || uploading || (!input.trim() && pendingAttachments.length === 0)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-[#04101f] transition hover:bg-[#7db6ff] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={15} />
                </button>
              </>
            )}
          </form>
        </GlassCard>

        <aside className="space-y-5">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">History</div>
              <button type="button" onClick={startNewChat} className="text-[11px] text-accent hover:text-white">
                New chat
              </button>
            </div>
            <div className="mt-4 grid max-h-56 gap-2 overflow-y-auto">
              {history.length === 0 && <div className="text-sm text-neutral-500">No saved conversations yet.</div>}
              {history.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => loadConversation(c.id)}
                    className={cn(
                      'flex-1 rounded-2xl border px-3 py-2.5 text-left text-sm transition',
                      conversationId === c.id
                        ? 'border-accent/40 bg-accent/10 text-white'
                        : 'border-white/8 bg-black/20 text-neutral-300 hover:border-white/20'
                    )}
                  >
                    {c.title || 'Untitled'}
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => deleteConversation(c.id)}
                    className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-neutral-500 hover:text-white"
                  >
                    Del
                  </button>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Suggested prompts</div>
            <div className="mt-4 grid gap-2.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-left text-sm text-neutral-300 transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-white/5 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">System health</div>
            <div className="mt-4 space-y-2.5 text-sm">
              {[
                { label: 'Chat endpoint', status: 'Active' },
                { label: 'Approvals queue', status: 'Ready' },
                { label: 'Knowledge store', status: 'Synced' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5">
                  <span className="text-neutral-300">{row.label}</span>
                  <span className="text-accent">{row.status}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </aside>
      </div>
    </div>
  );
}
