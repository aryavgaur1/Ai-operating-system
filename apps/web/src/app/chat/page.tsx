'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, type AgentTurnResult } from '@/lib/api';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  detail?: AgentTurnResult;
}

const SUGGESTIONS = [
  'Why is Project Phoenix delayed?',
  'What is the status of Acme Corp?',
  'Draft an email to the client about the new timeline',
  'Create a Jira ticket to track the vendor contract follow-up',
];

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(message: string) {
    if (!message.trim()) return;
    setInput('');
    setError(null);
    setTurns((t) => [...t, { role: 'user', content: message }]);
    setLoading(true);
    try {
      const result = await api.sendMessage(message);
      setTurns((t) => [...t, { role: 'assistant', content: result.reply, detail: result }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="glow-panel rounded-[32px] p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-2xl">
            <span className="badge badge-pill bg-white/5 text-white border-white/10">
              <span className="dot bg-accent2" /> Agent Core
            </span>
            <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight neon-text">Mission control for Nexora OS</h1>
            <p className="mt-4 text-base leading-7 text-neutral-300">
              Ask the agent anything across your connected tools. Nexora combines hybrid retrieval, intent planning,
              and safe tool execution to deliver fast, contextual answers and trusted action proposals.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#08101d]/95 p-6 shadow-xl backdrop-blur-sm">
            <div className="text-xs uppercase tracking-[0.3em] text-neutral-400">Live system state</div>
            <div className="mt-4 text-3xl font-semibold text-white">Claude OS</div>
            <div className="mt-2 text-sm text-neutral-400">Secure reasoning • tool orchestration • human approval flow</div>
            <div className="mt-5 grid gap-3 text-sm text-neutral-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Interactive agent session ready</div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Hybrid context store synced</div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Action approvals online</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.95fr]">
        <div className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-glow">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-neutral-400">Agent session</div>
              <h2 className="font-display text-2xl font-semibold text-white">Conversation</h2>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.24em] text-accent">Realtime</div>
          </div>

          <div className="space-y-4">
            {turns.map((turn, i) => (
              <div key={i} className={`rounded-[28px] border p-5 ${turn.role === 'user' ? 'border-accent/20 bg-accent/10' : 'border-white/10 bg-black/30'}`}>
                <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-neutral-400">
                  <span className={`h-2.5 w-2.5 rounded-full ${turn.role === 'user' ? 'bg-accent2' : 'bg-accent'}`} />
                  {turn.role === 'user' ? 'User' : 'Agent'}
                </div>
                <div className="whitespace-pre-wrap text-sm leading-7 text-neutral-100">{turn.content}</div>

                {turn.detail && (
                  <div className="mt-5 space-y-4 rounded-[24px] border-t border-white/10 pt-4 text-sm text-neutral-400">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Intent: {turn.detail.plan.intent.intent}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Confidence: {Math.round(turn.detail.plan.intent.confidence * 100)}%</span>
                    </div>
                    <div>{turn.detail.plan.intent.rationale}</div>

                    {turn.detail.plan.toolCalls.length > 0 && (
                      <div>
                        <div className="mb-3 text-sm font-semibold text-white">Proposed actions</div>
                        <div className="grid gap-3">
                          {turn.detail.plan.toolCalls.map((c, j) => (
                            <div key={j} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                              <div className="text-sm text-white">{c.tool}.{c.action}</div>
                              <div className="mt-1 text-xs text-neutral-400">Risk: {c.riskLevel} {c.requiresApproval ? '• approval required' : '• auto-executed'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {turns.length === 0 && (
              <div className="rounded-[28px] border border-white/10 bg-black/20 p-8 text-center text-sm text-neutral-400">
                Start a mission by asking something about your project, team, or tool integrations.
              </div>
            )}

            {loading && <div className="text-sm text-neutral-400">Processing your request…</div>}
            {error && <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mt-6 flex flex-col gap-3 sm:flex-row"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the agent something like “What is the quarter status?”"
              className="min-h-[56px] flex-1 rounded-3xl border border-white/10 bg-[#090d13] px-5 py-4 text-sm text-white outline-none transition focus:border-accent"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-3xl bg-accent px-6 py-4 text-sm font-semibold text-[#04101f] transition hover:bg-[#72b8ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send query
            </button>
          </form>
        </div>

        <aside className="space-y-6 rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-glow">
          <div className="rounded-[28px] border border-white/10 bg-[#09101f] p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-400">Quick commands</div>
            <div className="mt-4 grid gap-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-neutral-200 transition hover:border-accent hover:bg-white/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#09101f] p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-400">System health</div>
            <div className="mt-4 space-y-3 text-sm text-neutral-300">
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <span>Chat endpoint</span>
                <span className="text-accent">Active</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <span>Approvals queue</span>
                <span className="text-neutral-400">Ready</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <span>Knowledge store</span>
                <span className="text-neutral-400">Synced</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
