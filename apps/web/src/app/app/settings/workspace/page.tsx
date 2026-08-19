'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Check,
  Mail,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { GlassCard, Reveal, StaggerGroup } from '@/components/motion';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { api, type InvitationPublic, type MembershipRole, type WorkspaceMember } from '@/lib/api';
import { APP_ROUTES, inviteAcceptPath } from '@/lib/routes';
import { cn } from '@/lib/utils';

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function daysUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const d = Math.ceil(diff / 86400000);
  if (d <= 0) return 'expired';
  if (d === 1) return 'expires tomorrow';
  return `expires in ${d} days`;
}

/** Workspace avatar — initials from workspace name, colour from kind */
function WorkspaceAvatar({ name, kind, size = 'lg' }: { name: string; kind: string; size?: 'sm' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const dim = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-xs';
  const bg = kind === 'team' ? 'bg-accent/25 text-accent' : 'bg-white/10 text-neutral-200';
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-2xl font-bold', dim, bg)}>
      {initials || (kind === 'team' ? <Building2 size={20} /> : <UserRound size={20} />)}
    </span>
  );
}

/** Role badge */
function RoleBadge({ role }: { role: string }) {
  const color =
    role === 'owner'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : role === 'admin'
      ? 'border-accent/30 bg-accent/10 text-accent'
      : 'border-white/10 text-neutral-300';
  return (
    <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize', color)}>
      {role}
    </span>
  );
}

/** Rename workspace modal */
function RenameModal({
  currentName,
  orgId,
  onClose,
  onSuccess,
}: {
  currentName: string;
  orgId: string;
  onClose: () => void;
  onSuccess: (name: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) { setErr('Name must be at least 2 characters'); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.renameWorkspace(orgId, trimmed);
      onSuccess(res.workspace.name);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d1828] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg text-white">Rename workspace</h3>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
        {err && <p className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{err}</p>}
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-xs text-neutral-400">
            Workspace name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-accent/40"
              disabled={busy}
              maxLength={80}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || name.trim().length < 2}
              className="flex-1 rounded-full bg-accent py-2.5 text-sm font-semibold text-[#04101f] disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} disabled={busy}
              className="rounded-full border border-white/10 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function WorkspaceSettingsPage() {
  const { current, loading: wsLoading, error: wsError, refresh } = useWorkspaces();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<InvitationPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [lastAcceptLink, setLastAcceptLink] = useState<string | null>(null);
  const [showRename, setShowRename] = useState(false);
  const [localName, setLocalName] = useState<string | null>(null);

  const canManage = current?.kind === 'team' && (current.role === 'owner' || current.role === 'admin');
  const isOwner = current?.kind === 'team' && current.role === 'owner';
  const orgId = current?.organizationId;
  const displayName = localName ?? current?.name ?? '';

  const loadTeamData = useCallback(async () => {
    if (!orgId || current?.kind !== 'team') {
      setMembers([]); setInvitations([]); setLoading(false); return;
    }
    setLoading(true); setError(null);
    try {
      const membersRes = await api.listWorkspaceMembers(orgId);
      setMembers(membersRes.members || []);
      if (canManage) {
        const invRes = await api.listInvitations(orgId);
        setInvitations(invRes.invitations || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace details');
    } finally {
      setLoading(false);
    }
  }, [orgId, current?.kind, canManage]);

  useEffect(() => { void loadTeamData(); }, [loadTeamData]);
  useEffect(() => { setLocalName(null); }, [current?.organizationId]);

  function applyInviteResult(
    res: { invitation: InvitationPublic; email: { delivered: boolean; mode: string; errorCode?: string; hint?: string }; acceptToken?: string },
    verb: 'created' | 'resent'
  ) {
    if (res.email.delivered) {
      setMessage(`Invitation ${verb} — email delivered to ${res.invitation.email}.`);
      return;
    }
    const hint = res.email.hint || `Gmail API failed (${res.email.errorCode || res.email.mode}).`;
    setMessage(`Invitation ${verb}, but email not delivered. ${hint}`);
    if (res.acceptToken) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setLastAcceptLink(`${origin}${inviteAcceptPath(res.acceptToken)}`);
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !canManage) return;
    setBusy(true); setMessage(null); setError(null); setLastAcceptLink(null);
    try {
      const res = await api.createInvitation(orgId, { email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      applyInviteResult(res, 'created');
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally { setBusy(false); }
  }

  async function onRevoke(id: string) {
    if (!orgId || !canManage) return;
    setBusy(true); setError(null);
    try {
      await api.revokeInvitation(orgId, id);
      setMessage('Invitation revoked.');
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally { setBusy(false); }
  }

  async function onResend(id: string) {
    if (!orgId || !canManage) return;
    setBusy(true); setMessage(null); setError(null); setLastAcceptLink(null);
    try {
      const res = await api.resendInvitation(orgId, id);
      applyInviteResult(res, 'resent');
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resend failed');
    } finally { setBusy(false); }
  }

  async function onRoleChange(userId: string, role: MembershipRole) {
    if (!orgId || !isOwner) return;
    setBusy(true); setError(null);
    try {
      await api.updateMemberRole(orgId, userId, role);
      setMessage('Role updated.');
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role change failed');
    } finally { setBusy(false); }
  }

  async function onRemoveMember(userId: string, email: string) {
    if (!orgId || !canManage) return;
    if (!confirm(`Remove ${email} from this workspace?`)) return;
    setBusy(true); setError(null);
    try {
      await api.removeMember(orgId, userId);
      setMessage(`${email} has been removed.`);
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally { setBusy(false); }
  }

  const pending = invitations.filter((i) => i.status === 'pending');

  return (
    <>
      {showRename && orgId && (
        <RenameModal
          currentName={displayName}
          orgId={orgId}
          onClose={() => setShowRename(false)}
          onSuccess={(name) => {
            setLocalName(name);
            setShowRename(false);
            setMessage(`Workspace renamed to "${name}".`);
            void refresh();
          }}
        />
      )}

      <StaggerGroup className="space-y-6">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Workspace</p>
              <h1 className="font-display mt-2 text-3xl font-semibold text-white">Workspace settings</h1>
              <p className="mt-2 max-w-xl text-sm text-neutral-400">
                Manage your workspace, members, and invitations.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { void refresh(); void loadTeamData(); }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-neutral-300 hover:bg-white/5"
              >
                <RefreshCw size={13} /> Refresh
              </button>
              <Link href={APP_ROUTES.settings} className="rounded-full border border-white/10 px-4 py-2 text-xs text-neutral-300 hover:bg-white/5">
                Account settings
              </Link>
            </div>
          </div>
        </Reveal>

        {(wsError || error || message) && (
          <Reveal>
            <div className={cn('rounded-2xl border px-4 py-3 text-sm',
              error || wsError ? 'border-rose-500/30 bg-rose-500/10 text-rose-100' : 'border-accent2/30 bg-accent2/10 text-accent2')}>
              {error || wsError || message}
            </div>
          </Reveal>
        )}

        {lastAcceptLink && (
          <Reveal>
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
              <p className="font-medium">Accept link (email not delivered)</p>
              <a href={lastAcceptLink} className="mt-1 block break-all text-xs text-amber-100 underline">{lastAcceptLink}</a>
            </div>
          </Reveal>
        )}

        {/* Workspace identity card */}
        <Reveal>
          <GlassCard className="p-6">
            {wsLoading || !current ? (
              <p className="text-sm text-neutral-400">Loading workspace…</p>
            ) : (
              <div className="flex flex-wrap items-start gap-4">
                <WorkspaceAvatar name={displayName} kind={current.kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-display text-xl text-white">{displayName}</h2>
                    {current.kind === 'team' && isOwner && (
                      <button
                        type="button"
                        onClick={() => setShowRename(true)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-white"
                      >
                        <Pencil size={11} /> Rename
                      </button>
                    )}
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Type</dt>
                      <dd className="text-neutral-200">{current.kind === 'personal' ? 'Personal' : 'Team'}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Your role</dt>
                      <dd><RoleBadge role={current.role} /></dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Members</dt>
                      <dd className="text-neutral-200">{loading ? '…' : members.length}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Pending invites</dt>
                      <dd className="text-neutral-200">{loading ? '…' : pending.length}</dd>
                    </div>
                  </dl>
                  {current.kind === 'personal' && (
                    <p className="mt-4 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-neutral-400">
                      This is your private personal workspace. Team management is not available here.
                    </p>
                  )}
                </div>
              </div>
            )}
          </GlassCard>
        </Reveal>

        {current?.kind === 'team' && (
          <>
            {/* Members */}
            <Reveal>
              <GlassCard className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Users size={16} className="text-accent" />
                  <h3 className="font-display text-lg text-white">Members</h3>
                  <span className="text-xs text-neutral-500">{members.length} active</span>
                </div>
                {loading ? (
                  <p className="text-sm text-neutral-400">Loading members…</p>
                ) : members.length === 0 ? (
                  <p className="text-sm text-neutral-400">No active members.</p>
                ) : (
                  <ul className="divide-y divide-white/8">
                    {members.map((m) => (
                      <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 text-xs font-bold text-neutral-300">
                            {(m.displayName || m.email).slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <p className="text-sm text-white">{m.displayName || m.email}</p>
                            <p className="text-xs text-neutral-500">{m.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Role selector for owners — only for non-self */}
                          {isOwner && m.role !== 'owner' ? (
                            <select
                              value={m.role}
                              disabled={busy}
                              onChange={(e) => void onRoleChange(m.userId, e.target.value as MembershipRole)}
                              className="rounded-xl border border-white/10 bg-black/30 px-2.5 py-1 text-xs text-neutral-200 outline-none focus:border-accent/40"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <RoleBadge role={m.role} />
                          )}
                          <span className="rounded-full border border-accent2/20 bg-accent2/10 px-2.5 py-0.5 text-xs capitalize text-accent2">
                            {m.status}
                          </span>
                          {canManage && m.role !== 'owner' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onRemoveMember(m.userId, m.email)}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                              title="Remove member"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </GlassCard>
            </Reveal>

            {/* Invite member — owner/admin only */}
            {canManage && (
              <>
                <Reveal>
                  <GlassCard className="p-6">
                    <div className="mb-4 flex items-center gap-2">
                      <Mail size={16} className="text-accent" />
                      <h3 className="font-display text-lg text-white">Invite member</h3>
                    </div>
                    <form onSubmit={onInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="flex-1 text-xs text-neutral-400">
                        Email
                        <input
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-accent/40"
                          placeholder="teammate@company.com"
                          disabled={busy}
                        />
                      </label>
                      <label className="text-xs text-neutral-400 sm:w-36">
                        Role
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none"
                          disabled={busy}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f] disabled:opacity-50"
                      >
                        <Check size={14} />
                        {busy ? 'Sending…' : 'Send invite'}
                      </button>
                    </form>
                    <p className="mt-3 text-xs text-neutral-500">
                      A Gmail API invitation email is sent to the recipient. They sign in with that email and click{' '}
                      <strong>Accept invitation</strong>. Inviting an already-pending email resends a fresh link.
                    </p>
                  </GlassCard>
                </Reveal>

                {/* Pending invitations */}
                <Reveal>
                  <GlassCard className="p-6">
                    <div className="mb-4 flex items-center gap-2">
                      <Shield size={16} className="text-accent" />
                      <h3 className="font-display text-lg text-white">Invitations</h3>
                      <span className="text-xs text-neutral-500">
                        {pending.length} pending · {invitations.length} total
                      </span>
                    </div>
                    {loading ? (
                      <p className="text-sm text-neutral-400">Loading invitations…</p>
                    ) : invitations.length === 0 ? (
                      <p className="text-sm text-neutral-400">No invitations yet.</p>
                    ) : (
                      <ul className="space-y-3">
                        {invitations.map((inv) => (
                          <li key={inv.id} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm text-white">{inv.email}</p>
                                  <RoleBadge role={inv.role} />
                                  <span className={cn('rounded-full border px-2 py-0.5 text-xs capitalize',
                                    inv.status === 'pending' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-white/10 text-neutral-400')}>
                                    {inv.status}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-500">
                                  Invited by {inv.invitedByDisplayName || inv.invitedByEmail || 'unknown'}
                                  {' · '}{daysUntil(inv.expiresAt)}
                                </p>
                              </div>
                              {inv.status === 'pending' && (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void onResend(inv.id)}
                                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
                                  >
                                    Resend
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void onRevoke(inv.id)}
                                    className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10"
                                  >
                                    <X size={12} /> Revoke
                                  </button>
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </GlassCard>
                </Reveal>
              </>
            )}

            {!canManage && (
              <Reveal>
                <GlassCard className="p-6">
                  <p className="text-sm text-neutral-400">
                    You are a member of this workspace. Invite and management controls require owner or admin.
                  </p>
                </GlassCard>
              </Reveal>
            )}
          </>
        )}
      </StaggerGroup>
    </>
  );
}
