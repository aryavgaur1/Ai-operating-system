'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isPlatformAdminEmail } from '@/lib/platformAdmin';
import { APP_ROUTES } from '@/lib/routes';

type Tab = 'overview' | 'users' | 'workspaces' | 'logins' | 'integrations' | 'activity';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'logins', label: 'Login Activity' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'activity', label: 'Platform Activity' },
];

export default function AdminPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [userPagination, setUserPagination] = useState<any>(null);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [workspacePagination, setWorkspacePagination] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [workspaceKind, setWorkspaceKind] = useState<'all' | 'personal' | 'team'>('all');
  const [userPage, setUserPage] = useState(1);
  const [workspacePage, setWorkspacePage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [allowed, setAllowed] = useState(false);
  const [loginActivity, setLoginActivity] = useState<any[]>([]);
  const [loginStats, setLoginStats] = useState<any>(null);
  const [loginPeriod, setLoginPeriod] = useState<'today' | '7d' | '30d'>('7d');
  const [loginMethod, setLoginMethod] = useState<'all' | 'google' | 'password'>('all');
  const [loginOrder, setLoginOrder] = useState<'desc' | 'asc'>('desc');
  const [loginSearch, setLoginSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<any>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceDetail, setWorkspaceDetail] = useState<any>(null);

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

  const loadLoginActivity = useCallback(async () => {
    const data = await api.adminLoginActivity({
      period: loginPeriod,
      method: loginMethod === 'all' ? undefined : loginMethod,
      order: loginOrder,
      search: loginSearch || undefined,
    });
    setLoginActivity(data.events || []);
    setLoginStats(data.stats || null);
  }, [loginPeriod, loginMethod, loginOrder, loginSearch]);

  const loadUsers = useCallback(async () => {
    const u = await api.adminUsers({ search: search || undefined, page: userPage, limit: 50 });
    setUsers(u.users || []);
    setUserPagination(u.pagination || null);
  }, [search, userPage]);

  const loadWorkspaces = useCallback(async () => {
    const w = await api.adminWorkspaces({
      search: workspaceSearch || undefined,
      kind: workspaceKind === 'all' ? undefined : workspaceKind,
      page: workspacePage,
      limit: 50,
    });
    setWorkspaces(w.workspaces || []);
    setWorkspacePagination(w.pagination || null);
  }, [workspaceSearch, workspaceKind, workspacePage]);

  const loadCore = useCallback(async () => {
    const [m, i, a] = await Promise.all([
      api.adminMetrics(),
      api.adminIntegrations(),
      api.adminAudit(),
    ]);
    setMetrics(m);
    setConnections(i.connections || []);
    setEvents(a.events || []);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    loadCore()
      .then(() => setError(null))
      .catch((e: any) => setError(e?.message || 'Failed to load admin data'));
  }, [allowed, loadCore]);

  useEffect(() => {
    if (!allowed || (tab !== 'users' && tab !== 'overview')) return;
    loadUsers().catch((e: any) => setError(e?.message || 'Failed to load users'));
  }, [allowed, tab, loadUsers]);

  useEffect(() => {
    if (!allowed || tab !== 'workspaces') return;
    loadWorkspaces().catch((e: any) => setError(e?.message || 'Failed to load workspaces'));
  }, [allowed, tab, loadWorkspaces]);

  useEffect(() => {
    if (!allowed || tab !== 'logins') return;
    loadLoginActivity().catch((e: any) => setError(e?.message || 'Failed to load login activity'));
  }, [allowed, tab, loadLoginActivity]);

  useEffect(() => {
    if (!selectedUserId) {
      setUserDetail(null);
      return;
    }
    api
      .adminUserDetail(selectedUserId)
      .then(setUserDetail)
      .catch((e: any) => setError(e?.message || 'Failed to load user detail'));
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWorkspaceDetail(null);
      return;
    }
    api
      .adminWorkspaceMembers(selectedWorkspaceId)
      .then(setWorkspaceDetail)
      .catch((e: any) => setError(e?.message || 'Failed to load workspace members'));
  }, [selectedWorkspaceId]);

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
      await loadUsers();
      await loadCore();
      if (selectedUserId === userId) {
        setUserDetail(await api.adminUserDetail(userId));
      }
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
        <p className="mt-2 text-sm text-neutral-400">
          Real customers, workspaces, logins, and platform activity — founder admin only.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                tab === t.id ? 'border-accent/40 bg-accent/20 text-white' : 'border-white/10 text-neutral-400'
              }`}
            >
              {t.label}
              {t.id === 'users' && Number(metrics?.newUsersLast24h) > 0 ? (
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
            ['Active users (7d)', metrics.activeUsersLast7d ?? 0],
            ['Logins (24h)', metrics.loginsLast24h ?? 0],
            ['New users (24h)', metrics.newUsersLast24h ?? 0],
            ['Personal workspaces', metrics.personalWorkspaces ?? 0],
            ['Team workspaces', metrics.teamWorkspaces ?? 0],
            ['Active memberships', metrics.activeMemberships ?? 0],
            ['Connected integrations', metrics.connectedIntegrations],
            ['Verified users', metrics.verifiedUsers],
            ['Suspended', metrics.suspendedUsers],
            ['Pending approvals', metrics.pendingApprovals],
            ['Audit events (24h)', metrics.activityLast24h],
            ['Google signups', metrics.googleSignups],
            ['Email signups', metrics.emailSignups],
            ['Conversations', metrics.conversations],
          ].map(([label, value]) => (
            <div key={String(label)} className="glass rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
              <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="glass rounded-[28px] p-6">
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setUserPage(1);
                }}
                placeholder="Search users by name or email"
                className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <button onClick={() => void loadUsers()} className="rounded-full border border-white/10 px-4 text-sm">
                Search
              </button>
            </div>
            <div className="space-y-2">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-3 text-left text-sm transition ${
                    selectedUserId === u.id
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-white/8 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div className="min-w-0">
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
                    </div>
                    <div className="truncate text-xs text-neutral-500">
                      {u.email} · {u.active_workspace_name || u.workspace_name || '—'}
                      {u.active_workspace_kind || u.workspace_kind
                        ? ` (${u.active_workspace_kind || u.workspace_kind})`
                        : ''}
                      {u.last_login ? ` · last login ${new Date(u.last_login).toLocaleString()}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      disabled={busyId === u.id}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                      onClick={() => void runUserAction(u.id, () => api.adminVerify(u.id))}
                    >
                      Verify
                    </button>
                    <button
                      disabled={busyId === u.id}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                      onClick={() => void runUserAction(u.id, () => api.adminSuspend(u.id, !u.is_suspended))}
                    >
                      {u.is_suspended ? 'Unsuspend' : 'Suspend'}
                    </button>
                  </div>
                </button>
              ))}
              {!users.length && <div className="text-sm text-neutral-500">No users match this search.</div>}
            </div>
            {userPagination && (
              <div className="mt-4 flex items-center justify-between text-xs text-neutral-400">
                <span>
                  Page {userPagination.page} / {userPagination.totalPages} · {userPagination.total} users
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={userPage <= 1}
                    onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                    className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    disabled={userPage >= (userPagination.totalPages || 1)}
                    onClick={() => setUserPage((p) => p + 1)}
                    className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="glass rounded-[28px] p-6">
            {!userDetail ? (
              <p className="text-sm text-neutral-500">Select a user to inspect account context.</p>
            ) : (
              <div className="space-y-5 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">User</div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {userDetail.user.display_name || userDetail.user.email}
                  </div>
                  <div className="text-neutral-400">{userDetail.user.email}</div>
                  <div className="mt-2 space-y-1 text-xs text-neutral-500">
                    <div>Created: {userDetail.user.created_at ? new Date(userDetail.user.created_at).toLocaleString() : '—'}</div>
                    <div>Last login: {userDetail.user.last_login ? new Date(userDetail.user.last_login).toLocaleString() : '—'}</div>
                    <div>Auth: {userDetail.user.auth_provider === 'google' ? 'Google' : 'Email / password'}</div>
                    <div>
                      Status:{' '}
                      {userDetail.user.is_suspended
                        ? 'Suspended'
                        : userDetail.user.is_verified
                          ? 'Verified'
                          : 'Unverified'}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">Workspaces / memberships</div>
                  <div className="mt-2 space-y-2">
                    {(userDetail.workspaces || []).map((w: any) => (
                      <div key={w.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                        <div className="text-white">{w.name}</div>
                        <div className="text-xs text-neutral-500">
                          {w.kind === 'personal' ? 'Personal' : 'Team'} · {w.role} · {w.status}
                          {w.joinedAt ? ` · joined ${new Date(w.joinedAt).toLocaleDateString()}` : ''}
                        </div>
                      </div>
                    ))}
                    {!userDetail.workspaces?.length && (
                      <div className="text-xs text-neutral-500">No memberships found.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">Integrations</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {(['slack', 'gmail', 'notion', 'jira'] as const).map((tool) => (
                      <div key={tool} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 capitalize">
                        {tool} —{' '}
                        <span
                          className={
                            userDetail.integrationStatus?.[tool] === 'connected'
                              ? 'text-emerald-300'
                              : 'text-neutral-500'
                          }
                        >
                          {userDetail.integrationStatus?.[tool] === 'connected' ? 'Connected' : 'Not connected'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busyId === userDetail.user.id}
                    className="rounded-full border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() =>
                      void runUserAction(
                        userDetail.user.id,
                        () => api.adminResetPassword(userDetail.user.id),
                        'Reset email sent'
                      )
                    }
                  >
                    Reset PW
                  </button>
                  <button
                    disabled={busyId === userDetail.user.id}
                    className="rounded-full border border-rose-400/30 px-3 py-1 text-xs text-rose-300 disabled:opacity-50"
                    onClick={() => {
                      if (!window.confirm(`Delete user ${userDetail.user.email}? This cannot be undone.`)) return;
                      void runUserAction(userDetail.user.id, async () => {
                        await api.adminDeleteUser(userDetail.user.id);
                        setSelectedUserId(null);
                      });
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'workspaces' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="glass rounded-[28px] p-6">
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={workspaceSearch}
                onChange={(e) => {
                  setWorkspaceSearch(e.target.value);
                  setWorkspacePage(1);
                }}
                placeholder="Search workspaces"
                className="min-w-[180px] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <select
                value={workspaceKind}
                onChange={(e) => {
                  setWorkspaceKind(e.target.value as 'all' | 'personal' | 'team');
                  setWorkspacePage(1);
                }}
                className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-neutral-300"
              >
                <option value="all">All types</option>
                <option value="personal">Personal</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div className="space-y-2">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSelectedWorkspaceId(w.id)}
                  className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-3 text-left text-sm ${
                    selectedWorkspaceId === w.id
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-white/8 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div className="font-medium text-white">{w.name}</div>
                  <div className="text-xs text-neutral-500">
                    {w.kind === 'personal' ? 'Personal' : 'Team'} · {w.member_count} member
                    {w.member_count === 1 ? '' : 's'} · owner {w.owner_name || w.owner_email || '—'}
                    {w.created_at ? ` · created ${new Date(w.created_at).toLocaleDateString()}` : ''}
                  </div>
                </button>
              ))}
              {!workspaces.length && <div className="text-sm text-neutral-500">No workspaces found.</div>}
            </div>
            {workspacePagination && (
              <div className="mt-4 flex items-center justify-between text-xs text-neutral-400">
                <span>
                  Page {workspacePagination.page} / {workspacePagination.totalPages} · {workspacePagination.total}{' '}
                  workspaces
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={workspacePage <= 1}
                    onClick={() => setWorkspacePage((p) => Math.max(1, p - 1))}
                    className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    disabled={workspacePage >= (workspacePagination.totalPages || 1)}
                    onClick={() => setWorkspacePage((p) => p + 1)}
                    className="rounded-full border border-white/10 px-3 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="glass rounded-[28px] p-6">
            {!workspaceDetail ? (
              <p className="text-sm text-neutral-500">Select a workspace to inspect members.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-semibold text-white">{workspaceDetail.workspace.name}</div>
                  <div className="text-xs text-neutral-500">
                    {workspaceDetail.workspace.kind === 'personal' ? 'Personal workspace' : 'Team workspace'}
                    {workspaceDetail.workspace.created_at
                      ? ` · created ${new Date(workspaceDetail.workspace.created_at).toLocaleString()}`
                      : ''}
                  </div>
                </div>
                <div className="space-y-2">
                  {(workspaceDetail.members || []).map((m: any) => (
                    <div key={m.user_id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-sm">
                      <div className="text-white">{m.display_name || m.email}</div>
                      <div className="text-xs text-neutral-500">
                        {m.email} · {m.role} · {m.status}
                        {m.joined_at ? ` · joined ${new Date(m.joined_at).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                  ))}
                  {!workspaceDetail.members?.length && (
                    <div className="text-sm text-neutral-500">No members in this workspace.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="glass rounded-[28px] p-6 space-y-2">
          {connections.map((c, idx) => (
            <div
              key={c.id || `${c.tool}-${c.email}-${idx}`}
              className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-sm"
            >
              <div className="text-white">
                {c.tool} · {c.status}
              </div>
              <div className="text-xs text-neutral-500">
                {c.email || '—'} · {c.workspace_name || '—'}
                {c.workspace_kind ? ` (${c.workspace_kind})` : ''} · updated{' '}
                {c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}
              </div>
            </div>
          ))}
          {!connections.length && <div className="text-sm text-neutral-500">No connected integrations yet.</div>}
        </div>
      )}

      {tab === 'logins' && (
        <div className="space-y-4">
          <div className="glass rounded-[28px] p-6">
            <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Security</div>
            <h2 className="mt-2 text-2xl font-semibold text-white">Login Activity</h2>
            <p className="mt-2 text-sm text-neutral-400">
              Real successful sign-ins from login_history — no credentials exposed.
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
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    loginPeriod === p ? 'border-accent/40 bg-accent/20 text-white' : 'border-white/10 text-neutral-400'
                  }`}
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
              <input
                value={loginSearch}
                onChange={(e) => setLoginSearch(e.target.value)}
                placeholder="Filter by user / workspace"
                className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-neutral-300"
              />
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
                    <th className="pb-3 pr-4">IP</th>
                    <th className="pb-3 pr-4">Device</th>
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
                        <td className="py-3 pr-4">
                          {row.workspace_name || '—'}
                          {row.workspace_kind ? ` (${row.workspace_kind})` : ''}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">{row.ip || '—'}</td>
                        <td className="py-3 pr-4 text-xs">
                          {[row.device, row.browser].filter(Boolean).join(' · ') || '—'}
                        </td>
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

      {tab === 'activity' && (
        <div className="glass rounded-[28px] p-6 space-y-2">
          {events.map((e) => (
            <div key={e.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-xs text-neutral-300">
              <span className="text-neutral-500">{new Date(e.created_at).toLocaleString()}</span> · {e.event_type}
              {e.tool ? ` · ${e.tool}` : ''}
              {e.email || e.display_name ? ` · ${e.display_name || e.email}` : ''}
              {e.workspace_name ? ` · ${e.workspace_name}` : ''}
            </div>
          ))}
          {!events.length && <div className="text-sm text-neutral-500">No audit events yet.</div>}
        </div>
      )}
    </div>
  );
}
