'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';
import { Send, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { MarkdownLite } from '@/components/MarkdownLite';
import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; source: string }[];
  suggestions?: string[];
};

const FALLBACK_PROMPTS = [
  'What is Nexora?',
  'Show me AI Agents',
  'Explain Slack Integration',
  'Compare Nexora vs ChatGPT',
  'How does Memory work?',
  'Can I automate Slack?',
  'Enterprise Pricing',
  'Book a Demo',
];

export function ChatAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompts, setPrompts] = useState<string[]>(FALLBACK_PROMPTS);
  const [followUps, setFollowUps] = useState<string[]>(FALLBACK_PROMPTS.slice(0, 4));
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      content:
        "Hi — I'm the **Nexora Assistant**. Ask me anything about the AI Operating System: agents, Slack/Notion, memory, pricing, enterprise, or onboarding.",
      suggestions: FALLBACK_PROMPTS.slice(0, 4),
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Magnetic floating button
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 180, damping: 16, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 180, damping: 16, mass: 0.4 });

  useEffect(() => {
    fetch(`${API_URL}/marketing-chatbot/suggestions`)
      .then((r) => r.json())
      .then((body) => {
        const list = body?.data?.prompts;
        if (Array.isArray(list) && list.length) setPrompts(list);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, busy, followUps]);

  useEffect(() => {
    if (open) return;
    function onMove(e: MouseEvent) {
      const el = btnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const pull = 140;
      if (dist < pull) {
        const force = (1 - dist / pull) * 28;
        x.set((dx / (dist || 1)) * force);
        y.set((dy / (dist || 1)) * force);
      } else {
        x.set(0);
        y.set(0);
      }
    }
    function onLeave() {
      x.set(0);
      y.set(0);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, [open, x, y]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput('');
    setFollowUps([]);
    setMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);

    try {
      // Non-stream JSON is much faster than fake token delays
      const res = await fetch(`${API_URL}/marketing-chatbot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, stream: false }),
      });
      const body = await res.json().catch(() => ({}));
      const data = body?.data ?? body;
      const answer = data?.answer || 'Sorry — the assistant is temporarily unavailable.';
      const sources = data?.sources;
      const suggestions: string[] = Array.isArray(data?.suggestions) ? data.suggestions.slice(0, 4) : prompts.slice(0, 4);

      // Light typewriter without long waits — chunk every ~2 words
      const parts = answer.match(/\S+\s*/g) ?? [answer];
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        acc += parts[i];
        const snapshot = acc;
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: 'assistant', content: snapshot, sources };
          return next;
        });
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', content: answer, sources, suggestions };
        return next;
      });
      setFollowUps(suggestions);
    } catch {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: 'assistant',
          content: 'I could not reach the Nexora assistant API. Make sure the API is running on port 4000.',
          suggestions: prompts.slice(0, 4),
        };
        return next;
      });
      setFollowUps(prompts.slice(0, 4));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  function feedback(up: boolean) {
    void fetch(`${API_URL}/marketing-chatbot/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ up }),
    });
  }

  return (
    <>
      <motion.div
        className={cn('fixed bottom-5 right-5 z-[60]', open && 'pointer-events-none opacity-0')}
        animate={open ? undefined : { y: [0, -12, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.button
          ref={btnRef}
          type="button"
          aria-label="Open Nexora Assistant"
          onClick={() => setOpen(true)}
          style={{ x: springX, y: springY }}
          className="relative h-[72px] w-[72px] overflow-hidden rounded-full border border-white/25 bg-black shadow-[0_0_0_1px_rgba(91,157,255,0.4),0_12px_40px_rgba(91,157,255,0.45),0_0_60px_rgba(168,85,247,0.3)]"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.94 }}
        >
          <Image src="/nexora-chat-icon.png" alt="Nexora" fill className="object-cover" sizes="72px" priority />
          <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-sky-400/10 via-transparent to-fuchsia-500/15" />
          <span className="pointer-events-none absolute -inset-1 animate-pulse rounded-full bg-accent/20 blur-md" />
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-5 right-5 z-[70] flex h-[min(640px,calc(100vh-2.5rem))] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[28px] border border-white/15 bg-[rgba(8,10,16,0.82)] shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="relative h-9 w-9 overflow-hidden rounded-2xl border border-white/15">
                  <Image src="/nexora-chat-icon.png" alt="" fill className="object-cover" sizes="36px" />
                </span>
                <div>
                  <div className="font-display text-sm font-semibold text-white">Nexora Assistant</div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-400">Live · RAG grounded</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/10 p-2 text-neutral-400 hover:text-white"
                aria-label="Close assistant"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                      m.role === 'user'
                        ? 'bg-accent text-[#04101f]'
                        : 'border border-white/10 bg-white/[0.04] text-neutral-200'
                    )}
                  >
                    {m.role === 'assistant' ? (
                      <MarkdownLite content={m.content || (busy && i === messages.length - 1 ? '…' : '')} />
                    ) : (
                      m.content
                    )}
                    {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                      <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-neutral-500">
                        Sources: {m.sources.slice(0, 3).map((s) => s.title).join(' · ')}
                      </div>
                    )}
                    {m.role === 'assistant' && i > 0 && m.content && !busy && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => feedback(true)} className="text-neutral-500 hover:text-emerald-400" aria-label="Helpful">
                          <ThumbsUp size={12} />
                        </button>
                        <button type="button" onClick={() => feedback(false)} className="text-neutral-500 hover:text-rose-400" aria-label="Not helpful">
                          <ThumbsDown size={12} />
                        </button>
                      </div>
                    )}
                    {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && i === messages.length - 1 && !busy && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
                        {m.suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => void ask(s)}
                            className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] text-sky-200 hover:border-accent/50 hover:bg-accent/20"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="text-[11px] text-neutral-500">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:240ms]" />
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {!busy && followUps.length > 0 && messages.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-t border-white/8 px-3 py-2">
                {followUps.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void ask(p)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-neutral-300 hover:border-accent/40 hover:text-white"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            {messages.length <= 1 && (
              <div className="flex flex-wrap gap-1.5 border-t border-white/8 px-3 py-2">
                {prompts.slice(0, 6).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={busy}
                    onClick={() => void ask(p)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-neutral-300 hover:border-accent/40 hover:text-white"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/10 p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything about Nexora…"
                className="flex-1 rounded-full border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-accent/40"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-[#04101f] disabled:opacity-40"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
