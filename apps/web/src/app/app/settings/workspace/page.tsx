'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Mail, RefreshCw, Shield, UserRound, Users, X } from 'lucide-react';
import { GlassCard, Reveal, StaggerGroup } from '@/components/motion';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import {
  api,
  type InvitationPublic,
  type WorkspaceMember,
} from '@/lib/api';
import { APP_ROUTES, inviteAcceptPath } from '@/lib/routes';
import { cn } from '@/lib/utils';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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

  const canManage =
    current?.kind === 'team' && (current.role === 'owner' || current.role === 'admin');
  const orgId = current?.organizationId;

  const loadTeamData = useCallback(async () => {
    if (!orgId || current?.kind !== 'team') {
      setMembers([]);
      setInvitations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const membersRes = await api.listWorkspaceMembers(orgId);
      setMembers(membersRes.members || []);
      if (canManage) {
        const invRes = await api.listInvitations(orgId);
        setInvitations(invRes.invitations || []);
      } else {
        setInvitations([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace details');
    } finally {
      setLoading(false);
    }
  }, [orgId, current?.kind, canManage]);

  useEffect(() => {
    void loadTeamData();
  }, [loadTeamData]);

  function applyInviteResult(
    res: {
      invitation: InvitationPublic;
      email: { delivered: boolean; mode: string; errorCode?: string; hint?: string };
      acceptToken?: string;
    },
    verb: 'created' | 'resent'
  ) {
    if (res.email.delivered) {
      setMessage(
        `Invitation ${verb} and email delivered to ${res.invitation.email}. They should click “Accept Workspace Invitation” in that email (opens /invite/…).`
      );
      return;
    }
    const hint =
      res.email.hint ||
      `Gmail SMTP delivery failed (${res.email.errorCode || res.email.mode}). Check EMAIL_USER and EMAIL_PASS on the API service.`;
    setMessage(
      `Invitation ${verb}, but email was not delivered. ${hint} Share the accept link below.`
    );
    if (res.acceptToken) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setLastAcceptLink(`${origin}${inviteAcceptPath(res.acceptToken)}`);
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !canManage) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    setLastAcceptLink(null);
    try {
      const res = await api.createInvitation(orgId, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteEmail('');
      // createInvitation auto-resends when a pending invite already exists
      applyInviteResult(res, 'created');
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (!orgId || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeInvitation(orgId, id);
      setMessage('Invitation revoked.');
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  async function onResend(id: string) {
    if (!orgId || !canManage) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    setLastAcceptLink(null);
    try {
      const res = await api.resendInvitation(orgId, id);
      applyInviteResult(res, 'resent');
      await loadTeamData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resend failed');
    } finally {
      setBusy(false);
    }
  }

  const pending = invitations.filter((i) => i.status === 'pending');

  return (
    <StaggerGroup className="space-y-6">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Workspace</p>
            <h1 className="font-display mt-2 text-3xl font-semibold text-white">Workspace settings</h1>
            <p className="mt-2 max-w-xl text-sm text-neutral-400">
              Real organization data from the server. Personal stays private; team management uses
              membership roles.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                void refresh();
                void loadTeamData();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-neutral-300 hover:bg-white/5"
            >
              <RefreshCw size={13} />
              Refresh
            </button>
            <Link
              href={APP_ROUTES.settings}
              className="rounded-full border border-white/10 px-4 py-2 text-xs text-neutral-300 hover:bg-white/5"
            >
              Account settings
            </Link>
          </div>
        </div>
      </Reveal>

      {(wsError || error || message) && (
        <Reveal>
          <div
            className={cn(
              'rounded-2xl border px-4 py-3 text-sm',
              error || wsError
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
                : 'border-accent2/30 bg-accent2/10 text-accent2'
            )}
          >
            {error || wsError || message}
          </div>
        </Reveal>
      )}

      {lastAcceptLink && (
        <Reveal>
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
            <p className="font-medium">Accept link (email not delivered)</p>
            <a href={lastAcceptLink} className="mt-1 block break-all text-xs text-amber-100 underline">
              {lastAcceptLink}
            </a>
            <p className="mt-2 text-xs text-amber-100/70">
              Share only with the invited email identity. Do not treat this as proof email was sent.
            </p>
          </div>
        </Reveal>
      )}

      <Reveal>
        <GlassCard className="p-6">
          {wsLoading || !current ? (
            <p className="text-sm text-neutral-400">Loading workspace…</p>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              <span
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-2xl',
                  current.kind === 'team' ? 'bg-accent/20 text-accent' : 'bg-white/10 text-neutral-200'
                )}
              >
                {current.kind === 'team' ? <Building2 size={20} /> : <UserRound size={20} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl text-white">{current.name}</h2>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Type</dt>
                    <dd className="text-neutral-200">
                      {current.kind === 'personal' ? 'Personal workspace' : 'Team workspace'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Your role</dt>
                    <dd className="capitalize text-neutral-200">{current.role}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Status</dt>
                    <dd className="capitalize text-neutral-200">{current.status}</dd>
                  </div>
                </dl>
                {current.kind === 'personal' && (
                  <p className="mt-4 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-neutral-400">
                    This is your private personal workspace. Team invite and member controls are not
                    available here.
                  </p>
                )}
              </div>
            </div>
          )}
        </GlassCard>
      </Reveal>

      {current?.kind === 'team' && (
        <>
          <Reveal>
            <GlassCard className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <Users size={16} className="text-accent" />
                <h3 className="font-display text-lg text-white">Members</h3>
              </div>
              {loading ? (
                <p className="text-sm text-neutral-400">Loading members…</p>
              ) : members.length === 0 ? (
                <p className="text-sm text-neutral-400">No active members returned.</p>
              ) : (
                <ul className="divide-y divide-white/8">
                  {members.map((m) => (
                    <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="text-sm text-white">{m.displayName || m.email}</p>
                        <p className="text-xs text-neutral-500">{m.email}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded-full border border-white/10 px-2.5 py-1 capitalize text-neutral-300">
                          {m.role}
                        </span>
                        <span className="rounded-full border border-accent2/20 bg-accent2/10 px-2.5 py-1 capitalize text-accent2">
                          {m.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </Reveal>

          {canManage ? (
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
                    <label className="text-xs text-neutral-400 sm:w-40">
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
                      className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f] disabled:opacity-50"
                    >
                      {busy ? 'Sending…' : 'Invite member'}
                    </button>
                  </form>
                  <p className="mt-3 text-xs text-neutral-500">
                    Invitee gets an email with a join link to{' '}
                    <code className="text-neutral-400">/invite/…</code>. They sign in (or create an
                    account) with that same email, then click <strong>Let me in</strong>. Inviting an
                    email that is already pending re-sends a fresh link. Owner cannot be assigned by
                    invitation.
                  </p>
                </GlassCard>
              </Reveal>

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
                        <li
                          key={inv.id}
                          className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-white">{inv.email}</p>
                              <p className="mt-1 text-xs text-neutral-500">
                                Role <span className="capitalize text-neutral-300">{inv.role}</span>
                                {' · '}
                                Status <span className="capitalize text-neutral-300">{inv.status}</span>
                                {' · '}
                                Expires {formatDate(inv.expiresAt)}
                              </p>
                              <p className="mt-1 text-xs text-neutral-600">
                                Invited by{' '}
                                {inv.invitedByDisplayName || inv.invitedByEmail || inv.invitedByUserId}
                                {' · '}
                                Created {formatDate(inv.createdAt)}
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
                                  <X size={12} />
                                  Revoke
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
          ) : (
            <Reveal>
              <GlassCard className="p-6">
                <p className="text-sm text-neutral-400">
                  Member role: you can view the team and members. Invite and invitation management
                  require owner or admin.
                </p>
              </GlassCard>
            </Reveal>
          )}
        </>
      )}
    </StaggerGroup>
  );
}
