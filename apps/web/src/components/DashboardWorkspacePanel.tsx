'use client';

import Link from 'next/link';
import { Building2, Plus, Users } from 'lucide-react';
import { GlassCard } from '@/components/motion';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import { APP_ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Dashboard surface so workspace create/switch is impossible to miss. */
export function DashboardWorkspacePanel() {
  const { workspaces, current, loading, createTeam, activate, error } = useWorkspaces();
  const teams = workspaces.filter((w) => w.kind === 'team');
  const personal = workspaces.find((w) => w.kind === 'personal');

  async function quickCreate() {
    const name = window.prompt('Team workspace name');
    if (!name || name.trim().length < 2) return;
    try {
      const created = await createTeam(name.trim());
      await activate(created.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create workspace');
    }
  }

  return (
    <GlassCard className="p-5" hoverLift={false}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent2">Workspaces</p>
          <h2 className="font-display mt-1 text-xl text-white">
            {loading ? 'Loading…' : current?.name || 'Your workspace'}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            {current?.kind === 'team'
              ? `Team · you are ${current.role}`
              : 'Personal workspace (private)'}
            {personal ? ` · Home: ${personal.name}` : ''}
          </p>
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void quickCreate()}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-[#04101f]"
          >
            <Plus size={14} />
            Create Team Workspace
          </button>
          <Link
            href={APP_ROUTES.workspaceSettings}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-white hover:bg-white/5"
          >
            <Users size={14} />
            Members & invites
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => {
              if (!w.isActive) void activate(w.id);
            }}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition',
              w.isActive
                ? 'border-accent/40 bg-accent/15 text-white'
                : 'border-white/10 text-neutral-400 hover:border-white/20 hover:text-white'
            )}
          >
            {w.kind === 'team' ? <Building2 size={12} /> : null}
            {w.name}
            <span className="uppercase tracking-[0.12em] text-neutral-500">
              {w.kind === 'personal' ? 'Personal' : w.role}
            </span>
          </button>
        ))}
        {!loading && teams.length === 0 && (
          <span className="text-xs text-neutral-500">No team workspaces yet — create one above.</span>
        )}
      </div>
    </GlassCard>
  );
}
