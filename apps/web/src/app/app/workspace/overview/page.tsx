'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Mail, Pencil, RefreshCw, UserRound, Users } from 'lucide-react';
import { GlassCard, Reveal, StaggerGroup } from '@/components/motion';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { api, type WorkspaceMember } from '@/lib/api';
import { APP_ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

function WorkspaceAvatar({ name, kind }: { name: string; kind: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return (
    <span className={cn('flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold',
      kind === 'team' ? 'bg-accent/25 text-accent' : 'bg-white/10 text-neutral-200')}>
      {initials || (kind === 'team' ? <Building2 size={24} /> : <UserRound size={24} />)}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color = role === 'owner' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : role === 'admin' ? 'border-accent/30 bg-accent/10 text-accent'
    : 'border-white/10 text-neutral-300';
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize', color)}>{role}</span>;
}

export default function WorkspaceOverviewPage() {
  const { current, loading: wsLoading, refresh } = useWorkspaces();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const canManage = current?.kind === 'team' && (current.role === 'owner' || current.role === 'admin');
  const orgId = current?.organizationId;

  useEffect(() => {
    if (!orgId || current?.kind !== 'team') { setMembers([]); setPendingCount(0); return; }
    setLoading(true);
    const fetch = async () => {
      try {
        const [membersRes, invRes] = await Promise.all([
          api.listWorkspaceMembers(orgId),
          canManage ? api.listInvitations(orgId) : Promise.resolve({ invitations: [] }),
        ]);
        setMembers(membersRes.members || []);
        setPendingCount((invRes.invitations || []).filter((i) => i.status === 'pending').length);
      } catch { /* silently fail — not critical for overview */ } finally { setLoading(false); }
    };
    void fetch();
  }, [orgId, current?.kind, canManage]);

  return (
    <StaggerGroup className="space-y-6">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Workspace</p>
            <h1 className="font-display mt-2 text-3xl font-semibold text-white">Overview</h1>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-neutral-300 hover:bg-white/5">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <GlassCard className="p-6">
          {wsLoading || !current ? (
            <p className="text-sm text-neutral-400">Loading workspace…</p>
          ) : (
            <div className="flex flex-wrap items-start gap-6">
              <WorkspaceAvatar name={current.name} kind={current.kind} />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-display text-2xl font-semibold text-white">{current.name}</h2>
                  <span className={cn('rounded-full border px-3 py-1 text-xs font-medium',
                    current.kind === 'team' ? 'border-accent/30 bg-accent/10 text-accent' : 'border-white/10 text-neutral-400')}>
                    {current.kind === 'team' ? 'Team workspace' : 'Personal workspace'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-sm text-neutral-400">Your role:</p>
                  <RoleBadge role={current.role} />
                </div>
                {current.kind === 'personal' && (
                  <p className="mt-4 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-neutral-400">
                    Your private personal workspace. Team management controls are not available here.
                  </p>
                )}
              </div>
            </div>
          )}
        </GlassCard>
      </Reveal>

      {current?.kind === 'team' && (
        <>
          {/* Stats row */}
          <Reveal>
            <div className="grid gap-4 sm:grid-cols-2">
              <GlassCard className="p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <Users size={18} />
                  </span>
                  <div>
                    <p className="text-2xl font-bold text-white">{loading ? '…' : members.length}</p>
                    <p className="text-xs text-neutral-500">Active members</p>
                  </div>
                </div>
              </GlassCard>
              <GlassCard className="p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent2/15 text-accent2">
                    <Mail size={18} />
                  </span>
                  <div>
                    <p className="text-2xl font-bold text-white">{loading ? '…' : pendingCount}</p>
                    <p className="text-xs text-neutral-500">Pending invitations</p>
                  </div>
                </div>
              </GlassCard>
            </div>
          </Reveal>

          {/* Quick actions */}
          <Reveal>
            <GlassCard className="p-6">
              <h3 className="font-display mb-4 text-lg text-white">Quick actions</h3>
              <div className="flex flex-wrap gap-3">
                <Link href={APP_ROUTES.workspaceMembers}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm text-neutral-200 hover:bg-white/5">
                  <Users size={14} /> Manage members
                </Link>
                {canManage && (
                  <Link href={APP_ROUTES.workspaceSettings}
                    className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-[#04101f]">
                    <Mail size={14} /> Invite member
                  </Link>
                )}
                {current.role === 'owner' && (
                  <Link href={APP_ROUTES.workspaceSettings}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm text-neutral-200 hover:bg-white/5">
                    <Pencil size={14} /> Rename workspace
                  </Link>
                )}
              </div>
            </GlassCard>
          </Reveal>

          {/* Members preview */}
          {members.length > 0 && (
            <Reveal>
              <GlassCard className="p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-accent" />
                    <h3 className="font-display text-lg text-white">Members</h3>
                  </div>
                  <Link href={APP_ROUTES.workspaceMembers} className="text-xs text-accent2 hover:underline">
                    View all →
                  </Link>
                </div>
                <ul className="divide-y divide-white/8">
                  {members.slice(0, 5).map((m) => (
                    <li key={m.userId} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-xs font-bold text-neutral-300">
                          {(m.displayName || m.email).slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="text-sm text-white">{m.displayName || m.email}</p>
                          <p className="text-xs text-neutral-500">{m.email}</p>
                        </div>
                      </div>
                      <RoleBadge role={m.role} />
                    </li>
                  ))}
                </ul>
                {members.length > 5 && (
                  <Link href={APP_ROUTES.workspaceMembers} className="mt-3 block text-center text-xs text-accent2 hover:underline">
                    View all {members.length} members →
                  </Link>
                )}
              </GlassCard>
            </Reveal>
          )}
        </>
      )}
    </StaggerGroup>
  );
}
