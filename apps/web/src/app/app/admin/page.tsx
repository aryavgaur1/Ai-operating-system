'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function AdminPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'users' | 'integrations' | 'audit'>('overview');

  async function load() {
    try {
      const [m, u, i, a] = await Promise.all([
        api.adminMetrics(),
        api.adminUsers(search || undefined),
        api.adminIntegrations(),
        api.adminAudit(),
      ]);
      setMetrics(m);
      setUsers(u.users || []);
      setConnections(i.connections || []);
      setEvents(a.events || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6 pb-10">
      <div className="glass rounded-[28px] p-7">
        <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Admin</div>
        <h1 className="font-display mt-3 text-3xl font-semibold text-white">Control plane</h1>
        <p className="mt-2 text-sm text-neutral-400">Users, integrations, and system activity across Nexora.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {(['overview', 'users', 'integrations', 'audit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full border px-3 py-1.5 text-xs capitalize ${tab === t ? 'border-accent/40 bg-accent/20 text-white' : 'border-white/10 text-neutral-400'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      {tab === 'overview' && metrics && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ['Total users', metrics.totalUsers],
            ['Verified', metrics.verifiedUsers],
            ['Suspended', metrics.suspendedUsers],
            ['Integrations', metrics.connectedIntegrations],
            ['Conversations', metrics.conversations],
            ['Pending approvals', metrics.pendingApprovals],
            ['Google signups', metrics.googleSignups],
            ['Email signups', metrics.emailSignups],
          ].map(([label, value]) => (
            <div key={String(label)} className="glass rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
              <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div className="glass rounded-[28px] p-6">
          <div className="mb-4 flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users"
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <button onClick={load} className="rounded-full border border-white/10 px-4 text-sm">
              Search
            </button>
          </div>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-sm">
                <div>
                  <div className="font-medium text-white">{u.display_name || u.email}</div>
                  <div className="text-xs text-neutral-500">
                    {u.email} · {u.role} · {u.workspace_name || '—'} · {u.is_verified ? 'verified' : 'unverified'}
                    {u.is_suspended ? ' · suspended' : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-full border border-white/10 px-3 py-1 text-xs" onClick={() => api.adminVerify(u.id).then(load)}>
                    Verify
                  </button>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs"
                    onClick={() =>
                      api
                        .adminResetPassword(u.id)
                        .then(() => setError('Reset email sent (check API console if EMAIL_* unset)'))
                        .then(load)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Reset PW
                  </button>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs"
                    onClick={() => api.adminSetRole(u.id, u.role === 'admin' ? 'member' : 'admin').then(load)}
                  >
                    {u.role === 'admin' ? 'Make member' : 'Make admin'}
                  </button>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs"
                    onClick={() => api.adminSuspend(u.id, !u.is_suspended).then(load)}
                  >
                    {u.is_suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button className="rounded-full border border-rose-400/30 px-3 py-1 text-xs text-rose-300" onClick={() => api.adminDeleteUser(u.id).then(load)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="glass rounded-[28px] p-6 space-y-2">
          {connections.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-sm">
              <div className="text-white">{c.tool} · {c.status}</div>
              <div className="text-xs text-neutral-500">
                {c.email || '—'} · {c.workspace_name || '—'} · updated {c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}
              </div>
            </div>
          ))}
          {!connections.length && <div className="text-sm text-neutral-500">No connected integrations yet.</div>}
        </div>
      )}

      {tab === 'audit' && (
        <div className="glass rounded-[28px] p-6 space-y-2">
          {events.map((e) => (
            <div key={e.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-xs text-neutral-300">
              <span className="text-neutral-500">{new Date(e.created_at).toLocaleString()}</span> · {e.event_type}
              {e.tool ? ` · ${e.tool}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
