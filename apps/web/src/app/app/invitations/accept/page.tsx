'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, CheckCircle2, LogIn } from 'lucide-react';
import { GlassCard, Reveal } from '@/components/motion';
import { api, getAccessToken, type InvitationPreview } from '@/lib/api';
import { APP_ROUTES, LOGIN } from '@/lib/routes';
import { useWorkspaces } from '@/components/WorkspaceProvider';

function InvitationAcceptInner() {
  const search = useSearchParams();
  const router = useRouter();
  const token = (search.get('token') || '').trim();
  const { activate, refresh } = useWorkspaces();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(Boolean(getAccessToken()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError('Missing invitation token.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.previewInvitation(token);
        if (!cancelled) setPreview(res.invitation);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Invitation not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onAccept() {
    if (!token) return;
    if (!getAccessToken()) {
      const next = `${APP_ROUTES.invitationAccept}?token=${encodeURIComponent(token)}`;
      router.push(`${LOGIN}?next=${encodeURIComponent(next)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.acceptInvitation(token);
      await activate(res.membership.organizationId);
      await refresh();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <Reveal>
        <GlassCard className="p-8">
          <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Team invitation</p>
          <h1 className="font-display mt-2 text-2xl font-semibold text-white">Join a workspace</h1>

          {loading && <p className="mt-6 text-sm text-neutral-400">Loading invitation…</p>}

          {error && (
            <p className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          )}

          {!loading && preview && !done && (
            <div className="mt-6 space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/25 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent">
                  <Building2 size={18} />
                </span>
                <div>
                  <p className="text-lg text-white">{preview.organizationName}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {preview.organizationKind === 'team' ? 'Team workspace' : preview.organizationKind}
                  </p>
                </div>
              </div>
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                    Invited email
                  </dt>
                  <dd className="text-neutral-200">{preview.email}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Role</dt>
                  <dd className="capitalize text-neutral-200">{preview.role}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Status</dt>
                  <dd className="capitalize text-neutral-200">
                    {preview.expired ? 'expired' : preview.status}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Expires</dt>
                  <dd className="text-neutral-200">{new Date(preview.expiresAt).toLocaleString()}</dd>
                </div>
              </dl>

              {!authed && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-50">
                  Sign in with <strong>{preview.email}</strong> to accept. The invitation is bound to
                  that email.
                </p>
              )}

              <button
                type="button"
                disabled={busy || !preview.acceptable}
                onClick={() => void onAccept()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-[#04101f] disabled:opacity-50"
              >
                {authed ? (
                  busy ? (
                    'Accepting…'
                  ) : (
                    'Accept invitation'
                  )
                ) : (
                  <>
                    <LogIn size={16} />
                    Sign in to accept
                  </>
                )}
              </button>
              {!preview.acceptable && (
                <p className="text-xs text-neutral-500">
                  This invitation cannot be accepted (expired, revoked, or already used).
                </p>
              )}
            </div>
          )}

          {done && (
            <div className="mt-6 space-y-4 text-center">
              <CheckCircle2 className="mx-auto text-accent2" size={36} />
              <p className="text-white">You joined {preview?.organizationName || 'the team'}.</p>
              <Link
                href={APP_ROUTES.workspaceSettings}
                className="inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]"
              >
                Open workspace settings
              </Link>
            </div>
          )}
        </GlassCard>
      </Reveal>
    </div>
  );
}

export default function InvitationAcceptPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-400">
          Loading invitation…
        </div>
      }
    >
      <InvitationAcceptInner />
    </Suspense>
  );
}
