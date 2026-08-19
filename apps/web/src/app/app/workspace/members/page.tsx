'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, RefreshCw, Trash2, Users } from 'lucide-react';
import { GlassCard, Reveal, StaggerGroup } from '@/components/motion';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { api, type MembershipRole, type WorkspaceMember } from '@/lib/api';
import { APP_ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

function RoleBadge({ role }: { role: string }) {
  const color = role === 'owner' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : role === 'admin' ? 'border-accent/30 bg-accent/10 text-accent'
    : 'border-white/10 text-neutral-300';
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize', color)}>{role}</span>;
}

export default function WorkspaceMembersPage() {
  const { current, loading: wsLoading } = useWorkspaces();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage = current?.kind === 'team' && (current.role === 'owner' || current.role === 'admin');
  const isOwner = current?.kind === 'team' && current.role === 'owner';
  const orgId = current?.organizationId;

  const loadMembers = useCallback(async () => {
    if (!orgId || current?.kind !== 'team') { setMembers([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res = await api.listWorkspaceMembers(orgId);
      setMembers(res.members || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally { setLoading(false); }
  }, [orgId, current?.kind]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function onRoleChange(userId: string, role: MembershipRole) {
    if (!orgId || !isOwner) return;
    setBusy(true); setError(null);
    try {
      await api.updateMemberRole(orgId, userId, role);
      setMessage('Role updated successfully.');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role change failed');
    } finally { setBusy(false); }
  }

  async function onRemove(userId: string, email: string) {
    if (!orgId || !canManage) return;
    if (!confirm(`Remove ${email} from this workspace?`)) return;
    setBusy(true); setError(null);
    try {
      await api.removeMember(orgId, userId);
      setMessage(`${email} has been removed from the workspace.`);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally { setBusy(false); }
  }

  if (wsLoading) return <p className="text-sm text-neutral-400">Loading workspace…</p>;

  if (current?.kind !== 'team') {
    return (
      <GlassCard className="p-6">
        <p className="text-sm text-neutral-400">
          Member management is only available for team workspaces.{' '}
          <Link href={APP_ROUTES.workspaceSettings} className="text-accent2 underline">
            Switch to a team workspace
          </Link>
          .
        </p>
      </GlassCard>
    );
  }

  return (
    <StaggerGroup className="space-y-6">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Workspace · {current.name}</p>
            <h1 className="font-display mt-2 text-3xl font-semibold text-white">Members</h1>
            <p className="mt-1 text-sm text-neutral-400">{members.length} active member{members.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void loadMembers()}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-neutral-300 hover:bg-white/5">
              <RefreshCw size={13} /> Refresh
            </button>
            {canManage && (
              <Link href={APP_ROUTES.workspaceSettings}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-[#04101f]">
                <Mail size={13} /> Invite member
              </Link>
            )}
          </div>
        </div>
      </Reveal>

      {(error || message) && (
        <Reveal>
          <div className={cn('rounded-2xl border px-4 py-3 text-sm',
            error ? 'border-rose-500/30 bg-rose-500/10 text-rose-100' : 'border-accent2/30 bg-accent2/10 text-accent2')}>
            {error || message}
          </div>
        </Reveal>
      )}

      <Reveal>
        <GlassCard className="overflow-hidden p-0">
          {/* Table header */}
          <div className="hidden border-b border-white/8 px-6 py-3 sm:grid sm:grid-cols-[1fr_140px_120px_80px] sm:gap-4">
            <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Member</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Role</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Status</span>
            {canManage && <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Actions</span>}
          </div>

          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-neutral-400">Loading members…</div>
          ) : members.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <Users size={32} className="mx-auto mb-2 text-neutral-600" />
              <p className="text-sm text-neutral-400">No active members found.</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/8">
              {members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-4 px-6 py-4 sm:grid sm:grid-cols-[1fr_140px_120px_80px]">
                  {/* Member info */}
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 text-xs font-bold text-neutral-300">
                      {(m.displayName || m.email).slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{m.displayName || m.email}</p>
                      <p className="truncate text-xs text-neutral-500">{m.email}</p>
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    {isOwner && m.role !== 'owner' ? (
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => void onRoleChange(m.userId, e.target.value as MembershipRole)}
                        className="rounded-xl border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-neutral-200 outline-none focus:border-accent/40"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <span className="rounded-full border border-accent2/20 bg-accent2/10 px-2.5 py-0.5 text-xs capitalize text-accent2">
                      {m.status}
                    </span>
                  </div>

                  {/* Actions */}
                  {canManage && (
                    <div>
                      {m.role !== 'owner' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onRemove(m.userId, m.email)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                          title="Remove from workspace"
                        >
                          <Trash2 size={11} /> Remove
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </Reveal>
    </StaggerGroup>
  );
}
