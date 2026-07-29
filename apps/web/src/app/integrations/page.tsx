'use client';

import { useEffect, useState } from 'react';
import { api, type IntegrationStatus } from '@/lib/api';

const TOOL_LABELS: Record<string, string> = {
  slack: 'Slack',
  jira: 'Jira',
  gmail: 'Gmail',
  salesforce: 'Salesforce',
  notion: 'Notion',
};

export default function IntegrationsPage() {
  const [tools, setTools] = useState<IntegrationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listIntegrations()
      .then((res) => setTools(res.tools))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <span className="badge">
          <span className="dot bg-accent2" /> Connected Services
        </span>
        <h1 className="font-display mt-4 text-3xl font-semibold">Integrations</h1>
        <p className="mt-2 max-w-2xl text-neutral-400">
          Every connector currently runs in <code>mock</code> mode with realistic fixture data. Set{' '}
          <code>CONNECTORS_MODE=live</code> and fill in the credentials in <code>.env</code> once real OAuth apps
          are registered for each tool.
        </p>
      </div>

      {error && <div className="card border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
      {loading && <div className="text-sm text-neutral-500">Loading…</div>}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {tools.map((t) => (
          <div key={t.tool} className="card p-6">
            <div className="flex items-center justify-between">
              <div className="font-display text-lg font-semibold">{TOOL_LABELS[t.tool] ?? t.tool}</div>
              <span className={`badge ${t.status === 'active' ? 'border-emerald-500/40 text-emerald-300' : ''}`}>
                <span className={`dot ${t.status === 'active' ? 'bg-emerald-400' : 'bg-neutral-500'}`} />
                {t.status}
              </span>
            </div>
            <div className="mt-2 text-xs uppercase tracking-wide text-neutral-500">mode: {t.mode}</div>
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Available actions
              </div>
              <div className="flex flex-wrap gap-2">
                {t.availableActions.map((a) => (
                  <span key={a} className="rounded-full border border-line px-3 py-1 text-xs text-neutral-300">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
