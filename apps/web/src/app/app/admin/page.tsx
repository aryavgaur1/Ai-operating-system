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
  const [tab, setTab] = useState<'overview' | 'users' | 'integrations' | 'security' | 'audit'>('overview');
  const [allowed, setAllowed] = useState(false);
  const [loginActivity, setLoginActivity] = useState<any[]>([]);
  const [loginStats, setLoginStats] = useState<any>(null);
  const [loginPeriod, setLoginPeriod] = useState<'today' | '7d' | '30d'>('7d');
  const [loginMethod, setLoginMethod] = useState<'all' | 'google' | 'password'>('all');
  const [loginOrder, setLoginOrder] = useState<'desc' | 'asc'>('desc');

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

  async function loadLoginActivity() {
    const data = await api.adminLoginActivity({
      period: loginPeriod,
      method: loginMethod === 'all' ? undefined : loginMethod,
      order: loginOrder,
    });
    setLoginActivity(data.events || []);
    setLoginStats(data.stats || null);
  }

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

  useEffect(() => {
    if (!allowed || tab !== 'security') return;
    loadLoginActivity().catch((e: any) => setError(e?.message || 'Failed to load login activity'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, tab, loginPeriod, loginMethod, loginOrder]);

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
          {(['overview', 'users', 'integrations', 'security', 'audit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full border px-3 py-1.5 text-xs capitalize ${tab === t ? 'border-accent/40 bg-accent/20 text-white' : 'border-white/10 text-neutral-400'}`}
            >
              {t}
              {t === 'users' && Number(metrics?.newUsersLast24h) > 0 ? (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent2/90 px-1 text-[10px] font-semibold text-black">
                  {metrics.newUsersLast24h}
                </span>
              ) : null}
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
            ['New users (24h)', metrics.newUsersLast24h ?? 0],
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{u.display_name || u.email}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        u.auth_provider === 'google'
                          ? 'border-sky-400/30 bg-sky-400/10 text-sky-200'
                          : 'border-white/10 bg-white/5 text-neutral-400'
                      }`}
                    >
                      {u.auth_provider === 'google' ? 'Google' : 'Email'}
                    </span>
                    {u.created_at && Date.now() - new Date(u.created_at).getTime() < 24 * 60 * 60 * 1000 ? (
                      <span className="rounded-full border border-accent2/30 bg-accent2/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent2">
                        New
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {u.email} · {u.role} · {u.workspace_name || '—'} · {u.is_verified ? 'verified' : 'unverified'}
                    {u.is_suspended ? ' · suspended' : ''}
                    {u.last_login ? ` · last login ${new Date(u.last_login).toLocaleString()}` : ''}
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

      {tab === 'security' && (
        <div className="space-y-4">
          <div className="glass rounded-[28px] p-6">
            <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Security</div>
            <h2 className="mt-2 text-2xl font-semibold text-white">Login Activity</h2>
            <p className="mt-2 text-sm text-neutral-400">
              Real successful sign-ins across Nexora — platform administrator view only.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ['Successful logins today', loginStats?.logins_today ?? 0],
                ['Active workspaces (7d)', loginStats?.active_workspaces_7d ?? 0],
                ['Active members (7d)', loginStats?.active_members_7d ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {(['today', '7d', '30d'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setLoginPeriod(p)}
                  className={`rounded-full border px-3 py-1.5 text-xs ${loginPeriod === p ? 'border-accent/40 bg-accent/20 text-white' : 'border-white/10 text-neutral-400'}`}
                >
                  {p === 'today' ? 'Today' : p === '7d' ? 'Last 7 days' : 'Last 30 days'}
                </button>
              ))}
              <select
                value={loginMethod}
                onChange={(e) => setLoginMethod(e.target.value as 'all' | 'google' | 'password')}
                className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-neutral-300"
              >
                <option value="all">All methods</option>
                <option value="google">Google</option>
                <option value="password">Password</option>
              </select>
              <button
                onClick={() => setLoginOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-400"
              >
                {loginOrder === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>
          </div>

          <div className="glass rounded-[28px] p-6">
            <div className="mb-4 text-sm font-medium text-white">Recent login activity</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="pb-3 pr-4">User</th>
                    <th className="pb-3 pr-4">Method</th>
                    <th className="pb-3 pr-4">Workspace</th>
                    <th className="pb-3 pr-4">Time</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loginActivity.map((row) => {
                    const method =
                      row.authentication_method === 'google' || row.auth_provider === 'google'
                        ? 'Google'
                        : 'Password';
                    return (
                      <tr key={row.id} className="border-t border-white/8 text-neutral-300">
                        <td className="py-3 pr-4">
                          <div className="font-medium text-white">{row.display_name || row.email}</div>
                          <div className="text-xs text-neutral-500">{row.email}</div>
                        </td>
                        <td className="py-3 pr-4">{method}</td>
                        <td className="py-3 pr-4">{row.workspace_name || '—'}</td>
                        <td className="py-3 pr-4">{new Date(row.created_at).toLocaleString()}</td>
                        <td className="py-3">
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
                            Successful
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!loginActivity.length && (
              <div className="text-sm text-neutral-500">No successful logins in this period.</div>
            )}
          </div>
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
