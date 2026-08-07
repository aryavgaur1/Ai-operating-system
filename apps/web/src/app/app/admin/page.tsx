'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isPlatformAdminEmail } from '@/lib/platformAdmin';
import { APP_ROUTES } from '@/lib/routes';

export default function AdminPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'users' | 'integrations' | 'audit'>('overview');
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((me) => {
        if (!isPlatformAdminEmail(me.user.email)) {
          router.replace(APP_ROUTES.dashboard);
          return;
        }
        setAllowed(true);
      })
      .catch(() => router.replace(APP_ROUTES.dashboard));
  }, [router]);

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
      setError(e?.message || 'Failed to load admin data');
    }
  }

  useEffect(() => {
    if (!allowed) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, search]);

  if (!allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-400">
        Checking admin access…
      </div>
    );
  }

  async function runUserAction(userId: string, action: () => Promise<unknown>, successMessage?: string) {
    setBusyId(userId);
    setError(null);
    setInfo(null);
    try {
      await action();
      if (successMessage) setInfo(successMessage);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Admin action failed');
    } finally {
      setBusyId(null);
    }
  }

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
          <a
            href="/app/admin/chatbot"
            className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent"
          >
            Chatbot KB
          </a>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
      {info && <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-300">{info}</div>}

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
                  <button
                    disabled={busyId === u.id}
                    className="rounded-full border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() => runUserAction(u.id, () => api.adminVerify(u.id))}
                  >
                    Verify
                  </button>
                  <button
                    disabled={busyId === u.id}
                    className="rounded-full border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() =>
                      runUserAction(
                        u.id,
                        () => api.adminResetPassword(u.id),
                        'Reset email sent (check API console if EMAIL_* unset)'
                      )
                    }
                  >
                    Reset PW
                  </button>
                  <button
                    disabled={busyId === u.id}
                    className="rounded-full border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() =>
                      runUserAction(u.id, () => api.adminSetRole(u.id, u.role === 'admin' ? 'member' : 'admin'))
                    }
                  >
                    {u.role === 'admin' ? 'Make member' : 'Make admin'}
                  </button>
                  <button
                    disabled={busyId === u.id}
                    className="rounded-full border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() => runUserAction(u.id, () => api.adminSuspend(u.id, !u.is_suspended))}
                  >
                    {u.is_suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button
                    disabled={busyId === u.id}
                    className="rounded-full border border-rose-400/30 px-3 py-1 text-xs text-rose-300 disabled:opacity-50"
                    onClick={() => {
                      if (!window.confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
                      void runUserAction(u.id, () => api.adminDeleteUser(u.id));
                    }}
                  >
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
          {connections.map((c, idx) => (
            <div key={c.id || `${c.organizationId}-${c.tool}-${c.email}-${idx}`} className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-sm">
              <div className="text-white">{c.tool} · {c.status}</div>
              <div className="text-xs text-neutral-500">
                {c.email || '—'} · {c.workspace_name || '—'}
                {c.workspaceId ? ` (${c.workspaceId})` : ''} · updated{' '}
                {c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}
                {c.last_used_at ? ` · last used ${new Date(c.last_used_at).toLocaleString()}` : ''}
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
