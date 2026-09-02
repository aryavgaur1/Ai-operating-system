'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, getAccessToken, oauthConnectUrl, type IntegrationStatus } from '@/lib/api';
import {
  CONNECTION_TOOLS,
  formatCapabilities,
  formatConnectedSince,
  formatLastUsed,
  formatScope,
  resolveConnectionStatus,
  statusLabel,
  type ConnectionTool,
} from '@/lib/connectionCatalog';
import { WorkPageHeader } from '@/components/work/WorkPageHeader';
import { WorkAlert } from '@/components/work/WorkAlert';
import { WorkLoading } from '@/components/work/WorkLoading';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { cn } from '@/lib/utils';

function StatusBadge({ status }: { status: ReturnType<typeof resolveConnectionStatus> }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        status === 'connected' && 'bg-emerald-500/15 text-emerald-300',
        status === 'not_connected' && 'bg-white/5 text-neutral-500',
        status === 'needs_attention' && 'bg-amber-500/15 text-amber-200',
        status === 'unavailable' && 'bg-white/5 text-neutral-600'
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function ConnectionsCenter() {
  const searchParams = useSearchParams();
  const { current } = useWorkspaces();
  const [meta, setMeta] = useState<Record<string, IntegrationStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<ConnectionTool | null>(null);
  const [expanded, setExpanded] = useState<ConnectionTool | null>(null);
  const [notionToken, setNotionToken] = useState('');
  const [savingNotion, setSavingNotion] = useState(false);

  async function refresh() {
    const res = await api.listIntegrations();
    const next: Record<string, IntegrationStatus> = {};
    for (const t of res.tools) next[t.tool] = t;
    setMeta(next);
  }

  useEffect(() => {
    const connected = searchParams?.get('connected');
    const oauthError = searchParams?.get('error');
    if (connected) {
      setInfo(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully.`);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('connected');
        window.history.replaceState({}, '', url.toString());
      }
    }
    if (oauthError) {
      setError(decodeURIComponent(oauthError));
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('error');
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.organizationId]);

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    if (hash === 'slack' || hash === 'gmail' || hash === 'notion' || hash === 'jira') {
      setExpanded(hash);
    }
  }, []);

  const connectedCount = useMemo(
    () => CONNECTION_TOOLS.filter((t) => resolveConnectionStatus(meta[t.tool]) === 'connected').length,
    [meta]
  );

  function connect(tool: ConnectionTool) {
    const row = meta[tool];
    const url = row?.connectUrl || oauthConnectUrl(tool);
    if (!url) {
      if (!getAccessToken()) setError('Please sign in again, then retry Connect.');
      else setError(`Connect URL unavailable for ${tool}. Refresh and try again.`);
      return;
    }
    window.location.href = url;
  }

  async function disconnect(tool: ConnectionTool) {
    setBusy(tool);
    setError(null);
    setInfo(null);
    try {
      await api.disconnectIntegration(tool);
      setInfo(`${tool.charAt(0).toUpperCase() + tool.slice(1)} disconnected.`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveNotionToken() {
    const token = notionToken.trim();
    if (!token) {
      setError('Paste your Notion Internal Integration secret to connect.');
      return;
    }
    setSavingNotion(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.connectNotionToken(token);
      setNotionToken('');
      setInfo(`Notion connected${res.workspaceName ? `: ${res.workspaceName}` : ''}.`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingNotion(false);
    }
  }

  return (
    <div className="space-y-6">
      <WorkPageHeader
        title="Connections"
        description={`Connect your accounts so Nexora can search, propose actions, and execute approved changes in ${current?.name ?? 'this workspace'}. Credentials stay encrypted and are never shown here.`}
        meta={
          <span>
            <span className="text-white">{loading ? '—' : connectedCount}</span> of 4 connected
          </span>
        }
      />

      {error ? <WorkAlert variant="error">{error}</WorkAlert> : null}
      {info ? <WorkAlert variant="success" role="status">{info}</WorkAlert> : null}

      <div className="nx-panel overflow-hidden">
        {loading ? (
          <WorkLoading label="Loading connections…" />
        ) : (
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <th scope="col" className="px-4 py-3">Service</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Workspace scope</th>
              <th scope="col" className="px-4 py-3">Last used</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {CONNECTION_TOOLS.map((def) => {
              const row = meta[def.tool];
              const status = resolveConnectionStatus(row);
              const open = expanded === def.tool;
              const capabilities = formatCapabilities(def.tool, row?.availableActions || []);

              return (
                <Fragment key={def.tool}>
                  <tr id={def.tool} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-4">
                      <div className="font-medium text-white">{def.name}</div>
                      <div className="mt-0.5 max-w-md text-xs text-neutral-500">{def.description}</div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge status={status} />
                      {status === 'needs_attention' ? (
                        <p className="mt-1 text-xs text-amber-200/80">Reconnect to restore full Slack access.</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-neutral-300">{formatScope(row, def.scopeLabel)}</td>
                    <td className="px-4 py-4 text-neutral-500">{formatLastUsed(row)}</td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        {status === 'connected' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => connect(def.tool)}
                              className="nx-btn-secondary px-2.5 py-1 text-xs"
                            >
                              Reconnect
                            </button>
                            <button
                              type="button"
                              disabled={busy === def.tool}
                              onClick={() => disconnect(def.tool)}
                              className="nx-btn-danger px-2.5 py-1 text-xs disabled:opacity-50"
                            >
                              {busy === def.tool ? '…' : 'Disconnect'}
                            </button>
                          </>
                        ) : status !== 'unavailable' ? (
                          <button
                            type="button"
                            onClick={() => connect(def.tool)}
                            className="nx-btn-primary px-2.5 py-1 text-xs"
                          >
                            Connect
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : def.tool)}
                          className="nx-btn-ghost border border-white/10 px-2.5 py-1 text-xs"
                        >
                          {open ? 'Hide' : 'Details'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={5} className="bg-black/20 px-4 py-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-neutral-500">What Nexora can do</div>
                            {loading ? (
                              <p className="mt-2 text-sm text-neutral-500">Loading capabilities…</p>
                            ) : capabilities.length === 0 ? (
                              <p className="mt-2 text-sm text-neutral-500">Connect to see available capabilities.</p>
                            ) : (
                              <ul className="mt-2 space-y-1.5 text-sm text-neutral-300">
                                {capabilities.map((cap) => (
                                  <li key={cap} className="flex gap-2">
                                    <span className="text-emerald-400">✓</span>
                                    <span>{cap}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {def.tool === 'gmail' ? (
                              <p className="mt-3 text-xs text-neutral-500">
                                Email uses the Gmail API only — not SMTP or third-party senders.
                              </p>
                            ) : null}
                          </div>
                          <div className="text-sm">
                            <dl className="grid gap-2">
                              <div>
                                <dt className="text-[10px] uppercase text-neutral-500">Connection status</dt>
                                <dd className="text-neutral-300">{statusLabel(status)}</dd>
                              </div>
                              <div>
                                <dt className="text-[10px] uppercase text-neutral-500">Workspace scope</dt>
                                <dd className="text-neutral-300">{formatScope(row, def.scopeLabel)}</dd>
                              </div>
                              <div>
                                <dt className="text-[10px] uppercase text-neutral-500">Connected since</dt>
                                <dd className="text-neutral-400">{formatConnectedSince(row)}</dd>
                              </div>
                              <div>
                                <dt className="text-[10px] uppercase text-neutral-500">Nexora workspace</dt>
                                <dd className="text-neutral-400">{current?.name ?? '—'}</dd>
                              </div>
                            </dl>

                            {def.tool === 'notion' && status !== 'connected' ? (
                              <div className="mt-4 rounded-lg border border-white/10 p-3">
                                <div className="text-xs font-medium text-neutral-300">Alternative: Internal integration</div>
                                <p className="mt-1 text-xs text-neutral-500">
                                  If OAuth hangs, paste an Internal Integration secret (not shown after save).
                                </p>
                                <input
                                  type="password"
                                  autoComplete="off"
                                  value={notionToken}
                                  onChange={(e) => setNotionToken(e.target.value)}
                                  placeholder="secret_… or ntn_…"
                                  className="nx-input mt-2"
                                />
                                <button
                                  type="button"
                                  disabled={savingNotion || !notionToken.trim()}
                                  onClick={saveNotionToken}
                                  className="nx-btn-secondary mt-2 px-3 py-1.5 text-xs disabled:opacity-50"
                                >
                                  {savingNotion ? 'Connecting…' : 'Save integration secret'}
                                </button>
                              </div>
                            ) : null}

                            {def.tool === 'notion' && status === 'connected' ? (
                              <p className="mt-3 text-xs text-neutral-500">
                                Share pages with your Notion integration or Nexora cannot write to them.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      <p className="text-xs text-neutral-600">
        Nexora never displays access tokens, refresh tokens, API keys, or client secrets in this UI. Each user connects
        their own accounts; team workspace isolation is enforced on the backend.
      </p>
    </div>
  );
}
