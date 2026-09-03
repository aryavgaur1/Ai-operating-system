'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Building2, Check, ChevronDown, Plus, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_ROUTES } from '@/lib/routes';
import { useWorkspaces } from '@/components/WorkspaceProvider';
import type { WorkspaceListItem } from '@/lib/api';

/**
 * Visible workspace switcher in the authenticated shell.
 * Data from GET /workspaces only — never hardcoded teams.
 */
export function WorkspaceSwitcher({
  defaultOpen = false,
  compact = false,
}: {
  defaultOpen?: boolean;
  compact?: boolean;
} = {}) {
  const { workspaces, current, loading, error, activate, createTeam, refresh } = useWorkspaces();
  const [open, setOpen] = useState(defaultOpen);
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onCloseOthers(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail !== 'workspace') setOpen(false);
    }
    window.addEventListener('nexora:close-overlays', onCloseOthers as EventListener);
    return () => window.removeEventListener('nexora:close-overlays', onCloseOthers as EventListener);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 320;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setCoords({ top: r.bottom + 8, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const personal = workspaces.filter((w) => w.kind === 'personal');
  const teams = workspaces.filter((w) => w.kind === 'team');
  const activeLabel = current?.name || (loading ? 'Loading…' : 'Select workspace');
  const activeKind = current?.kind;

  async function onSelect(ws: WorkspaceListItem) {
    if (ws.isActive || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await activate(ws.id);
      setOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not switch workspace');
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = teamName.trim();
    if (name.length < 2) {
      setActionError('Workspace name must be at least 2 characters');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const created = await createTeam(name);
      setTeamName('');
      setCreateOpen(false);
      setOpen(false);
      await activate(created.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not create workspace');
    } finally {
      setBusy(false);
    }
  }

  const menu =
    mounted &&
    open &&
    coords &&
    createPortal(
      <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16 }}
          style={{ top: coords.top, left: coords.left }}
          className="menu-panel fixed z-[300] w-[min(320px,calc(100vw-16px))] max-h-[min(70vh,520px)] overflow-y-auto rounded-[22px] border border-accent/30 p-2"
          role="listbox"
        >
          {(error || actionError) && (
            <p className="mb-2 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {actionError || error}
            </p>
          )}

          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
            Your workspaces
          </p>
          <p className="px-2 pb-2 text-[10px] uppercase tracking-[0.16em] text-neutral-600">Personal</p>
          {loading && personal.length === 0 ? (
            <p className="px-3 py-2 text-xs text-neutral-500">Loading…</p>
          ) : personal.length === 0 ? (
            <p className="px-3 py-2 text-xs text-neutral-500">No personal workspace returned.</p>
          ) : (
            personal.map((ws) => <WorkspaceRow key={ws.id} ws={ws} busy={busy} onSelect={onSelect} />)
          )}

          <div className="my-2 h-px bg-white/10" />
          <p className="px-2 pb-2 text-[10px] uppercase tracking-[0.16em] text-neutral-600">Teams</p>
          {teams.length === 0 ? (
            <p className="px-3 py-2 text-xs text-neutral-500">You don&apos;t belong to a team yet.</p>
          ) : (
            teams.map((ws) => <WorkspaceRow key={ws.id} ws={ws} busy={busy} onSelect={onSelect} />)
          )}

          <div className="my-2 h-px bg-white/10" />
          {!createOpen ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCreateOpen(true);
                setActionError(null);
              }}
              className="flex w-full items-center gap-2 rounded-xl bg-accent/15 px-3 py-3 text-sm font-semibold text-accent hover:bg-accent/25"
            >
              <Plus size={16} />
              Create Team Workspace
            </button>
          ) : (
            <form onSubmit={onCreate} className="space-y-2 px-1 pb-1">
              <label className="block px-1 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                Workspace name
              </label>
              <input
                autoFocus
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Acme"
                className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-accent/40"
                disabled={busy}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 rounded-full bg-accent px-3 py-2 text-xs font-semibold text-[#04101f] disabled:opacity-50"
                >
                  {busy ? 'Creating…' : 'Create Workspace'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCreateOpen(false)}
                  className="rounded-full border border-white/10 px-3 py-2 text-xs text-neutral-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <Link
            href={APP_ROUTES.workspaceSettings}
            onClick={() => setOpen(false)}
            className="mt-1 flex w-full items-center rounded-xl px-3 py-2.5 text-xs font-medium text-neutral-300 hover:bg-white/5 hover:text-white"
          >
            Workspace settings · Members · Invites
          </Link>
        </motion.div>,
      document.body
    );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) {
              window.dispatchEvent(new CustomEvent('nexora:close-overlays', { detail: 'workspace' }));
              void refresh();
            }
            return next;
          });
        }}
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-2xl border border-accent/35 bg-accent/10 text-left transition hover:border-accent/55 hover:bg-accent/15',
          // Keep a usable hit target at laptop widths; truncate the label instead of collapsing the control.
          compact
            ? 'w-[clamp(9.5rem,18vw,13.5rem)] max-w-[13.5rem] px-2 py-1.5 sm:w-[clamp(10.5rem,16vw,14.5rem)] sm:max-w-[14.5rem]'
            : 'min-w-[11rem] max-w-[16rem] px-3 py-2'
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Workspace switcher: ${activeLabel}`}
        title={activeLabel}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl',
            compact ? 'h-6 w-6' : 'h-8 w-8',
            activeKind === 'team' ? 'bg-accent/25 text-accent' : 'bg-white/10 text-neutral-200'
          )}
        >
          {activeKind === 'team' ? <Building2 size={compact ? 12 : 15} /> : <UserRound size={compact ? 12 : 15} />}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="hidden text-[9px] font-semibold uppercase tracking-[0.18em] text-accent2 sm:block">
            {activeKind === 'team' ? 'Team' : activeKind === 'personal' ? 'Personal' : 'Workspace'}
          </span>
          <span className="block truncate text-xs font-semibold text-white sm:text-sm">{activeLabel}</span>
          {!compact && (
            <span className="hidden text-[10px] uppercase tracking-[0.14em] text-neutral-500 lg:block">
              {activeKind === 'team' ? 'Team' : activeKind === 'personal' ? 'Personal' : '—'}
              {current?.role ? ` · ${current.role}` : ''}
              {current ? ' · Active' : ''}
            </span>
          )}
        </span>
        <ChevronDown size={14} className={cn('shrink-0 text-accent transition', open && 'rotate-180')} />
      </button>
      {menu}
    </div>
  );
}

function WorkspaceRow({
  ws,
  busy,
  onSelect,
}: {
  ws: WorkspaceListItem;
  busy: boolean;
  onSelect: (ws: WorkspaceListItem) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={ws.isActive}
      disabled={busy}
      onClick={() => onSelect(ws)}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition',
        ws.isActive ? 'bg-accent/15 ring-1 ring-accent/30' : 'hover:bg-white/5'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
          ws.kind === 'team' ? 'bg-accent/15 text-accent' : 'bg-white/8 text-neutral-300'
        )}
      >
        {ws.kind === 'team' ? <Building2 size={14} /> : <UserRound size={14} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-white">{ws.name}</span>
        <span className="block text-[10px] uppercase tracking-[0.14em] text-neutral-500">
          {ws.kind === 'personal' ? 'Personal' : 'Team'} · {ws.role}
          {ws.isActive ? ' · Active' : ''}
        </span>
      </span>
      {ws.isActive && <Check size={14} className="shrink-0 text-accent2" />}
    </button>
  );
}
