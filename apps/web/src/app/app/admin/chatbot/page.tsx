'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, getAccessToken } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function AdminChatbotPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [d, a] = await Promise.all([api.adminChatbotDocs(), api.adminChatbotAnalytics()]);
      setDocs(d.docs || []);
      setAnalytics(a);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function reindex() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.adminChatbotReindex();
      setStatus(`Re-indexed ${r.docs} docs / ${r.chunks} chunks`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('file') as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const token = getAccessToken();
      const res = await fetch(`${API_URL}/admin/chatbot/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: 'include',
        body,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Upload failed');
      setStatus(`Uploaded and indexed: ${file.name}`);
      form.reset();
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="glass rounded-[28px] p-7">
        <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Admin · Chatbot</div>
        <h1 className="font-display mt-3 text-3xl font-semibold text-white">Marketing AI knowledge</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Re-index website knowledge, upload PDFs/DOCX/Markdown, and monitor assistant analytics. New files are
          embedded into the RAG store automatically.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void reindex()}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#04101f] disabled:opacity-50"
          >
            Re-index website
          </button>
          <a href="/app/admin" className="rounded-full border border-white/15 px-4 py-2 text-sm text-neutral-300">
            Back to Admin
          </a>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
      {status && <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-200">{status}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={onUpload} className="glass rounded-[28px] p-6">
          <h2 className="font-display text-lg text-white">Upload documents</h2>
          <p className="mt-1 text-sm text-neutral-500">PDF, DOCX, Markdown, TXT, JSON, CSV — investor decks, API docs, release notes.</p>
          <input
            name="file"
            type="file"
            accept=".pdf,.docx,.md,.txt,.markdown,.json,.csv"
            className="mt-4 block w-full text-sm text-neutral-300 file:mr-3 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#04101f]"
          />
          <button
            type="submit"
            disabled={busy}
            className="mt-4 rounded-full border border-white/15 px-4 py-2 text-sm text-white hover:border-accent/40 disabled:opacity-50"
          >
            Upload & index
          </button>
        </form>

        {analytics && (
          <div className="glass rounded-[28px] p-6">
            <h2 className="font-display text-lg text-white">Analytics</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ['Questions', analytics.totalQuestions],
                ['Failed', analytics.failedQuestions],
                ['Avg latency', `${analytics.averageResponseTimeMs}ms`],
                ['👍 / 👎', `${analytics.satisfactionUp} / ${analytics.satisfactionDown}`],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">{k}</div>
                  <div className="mt-1 text-xl font-semibold text-white">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">Most asked</div>
              <ul className="mt-2 space-y-1 text-xs text-neutral-300">
                {(analytics.mostAsked || []).slice(0, 5).map((row: any) => (
                  <li key={row.q}>
                    {row.count}× — {row.q}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="glass rounded-[28px] p-6">
        <h2 className="font-display text-lg text-white">Indexed sources ({docs.length})</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="pb-2 pr-4">Title</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Chunks</th>
                <th className="pb-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-white/8 text-neutral-300">
                  <td className="py-2 pr-4 text-white">{d.title}</td>
                  <td className="py-2 pr-4 capitalize">{d.type}</td>
                  <td className="py-2 pr-4">{d.chunkCount}</td>
                  <td className="py-2 font-mono text-xs text-neutral-500">{d.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
