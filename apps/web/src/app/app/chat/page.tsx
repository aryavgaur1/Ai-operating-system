'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  FileUp,
  Mic,
  Quote,
  Send,
  Sparkles,
  Terminal,
  Wand2,
} from 'lucide-react';
import { api, type AgentTurnResult } from '@/lib/api';
import { GlassCard, Reveal } from '@/components/motion';
import { MarkdownLite } from '@/components/MarkdownLite';
import { cn } from '@/lib/utils';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  detail?: AgentTurnResult;
}

const SUGGESTIONS = [
  'Why is Project Phoenix delayed?',
  'What is the status of Acme Corp?',
  'Draft an email to the client about the new timeline',
  'Create a Jira ticket to track the vendor contract follow-up',
];

const riskBadgeClasses: Record<string, string> = {
  low: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
  medium: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
  high: 'bg-rose-500/12 text-rose-300 border-rose-500/25',
};

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [history, setHistory] = useState<{ id: string; title: string; pinned?: boolean }[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function refreshHistory() {
    try {
      const res = await api.listConversations();
      setHistory(res.conversations || []);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns.length, loading]);

  async function loadConversation(id: string) {
    try {
      const data = await api.getConversation(id);
      setConversationId(id);
      setTurns(
        (data.messages || []).map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
          timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        }))
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function send(message: string) {
    if (!message.trim()) return;
    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setInput('');
    setError(null);
    setTurns((t) => [...t, { role: 'user', content: message, timestamp: now }]);
    setLoading(true);
    try {
      const result = await api.sendMessage(message, conversationId);
      if (result.conversationId) setConversationId(result.conversationId);
      const replyTime = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      setTurns((t) => [...t, { role: 'assistant', content: result.reply, detail: result, timestamp: replyTime }]);
      refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

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
    setConversationId(undefined);
    setTurns([]);
    setError(null);
  }

  async function deleteConversation(id: string) {
    await api.deleteConversation(id);
    if (conversationId === id) startNewChat();
    refreshHistory();
  }

  return (
    <div className="space-y-6">
      <Reveal>
        <GlassCard variant="glow" className="p-7" hoverLift={false}>
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-2xl">
              <span className="badge border-white/10 bg-white/5 text-white">
                <Sparkles size={12} className="text-accent2" /> Agent core
              </span>
              <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Mission control for <span className="gradient-text">Nexora OS</span>
              </h1>
              <p className="mt-3 text-sm leading-7 text-neutral-400">
                Ask the agent anything across your connected tools. Nexora combines hybrid retrieval, intent
                planning, and safe tool execution to deliver fast, contextual answers and trusted action proposals.
              </p>
            </div>

            <div className="w-full max-w-sm rounded-[24px] border border-white/10 bg-black/25 p-5">
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

      <div className="grid gap-6 xl:grid-cols-[1.6fr_0.9fr]">
        <GlassCard className="flex min-h-[560px] flex-col p-6" hoverLift={false}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Agent session</div>
              <h2 className="font-display text-xl font-semibold text-white">Conversation</h2>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-accent">
              Realtime
            </span>
          </div>

          <div className="thin-scroll flex-1 space-y-4 overflow-y-auto pr-1">
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
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {turns.length === 0 && (
              <div className="mx-auto max-w-lg rounded-[28px] border border-white/10 bg-black/20 px-8 py-14 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/5 text-accent2">
                  <Wand2 size={26} />
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">Your Nexora session is ready.</h3>
                <p className="text-sm leading-6 text-neutral-400">
                  Start with a question about your project, tools, or team and watch Nexora turn it into a safe
                  action plan.
                </p>
              </div>
            )}

            {loading && (
              <div className="mr-auto flex max-w-[70%] items-center gap-2 rounded-[26px] border border-white/12 bg-white/5 px-5 py-3.5 text-sm text-neutral-300">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-dots rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-dots rounded-full bg-accent" style={{ animationDelay: '160ms' }} />
                  <span className="h-1.5 w-1.5 animate-dots rounded-full bg-accent" style={{ animationDelay: '320ms' }} />
                </span>
                thinking
              </div>
            )}
            {error && <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3.5 text-sm text-red-300">{error}</div>}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mt-5 flex items-center gap-2 rounded-[26px] border border-white/10 bg-black/25 p-2 pl-4 transition focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15"
          >
            <button
              type="button"
              title="Attach a file (coming soon)"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-white/5 hover:text-white"
            >
              <FileUp size={16} />
            </button>
            <button
              type="button"
              title="Voice input (coming soon)"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-white/5 hover:text-white"
            >
              <Mic size={16} />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the agent something…"
              className="min-h-[44px] flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-[#04101f] transition hover:bg-[#7db6ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={15} />
            </button>
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
