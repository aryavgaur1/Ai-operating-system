'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Building2, CheckCircle2, LogIn, UserPlus } from 'lucide-react';
import { GlassCard } from '@/components/motion';
import {
  api,
  getAccessToken,
  type InvitationPreview,
} from '@/lib/api';
import { APP_ROUTES, LOGIN, REGISTER, inviteAcceptPath } from '@/lib/routes';

function InviteAcceptInner() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = decodeURIComponent(String(params?.token || '').trim());

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const nextPath = inviteAcceptPath(token);

  useEffect(() => {
    setAuthed(Boolean(getAccessToken()));
    if (getAccessToken()) {
      api
        .me()
        .then((r) => setMeEmail(r.user.email || null))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token || token.length < 16) {
        setError('Missing or invalid invitation token.');
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

  function goAuth(mode: 'login' | 'register') {
    const q = `?next=${encodeURIComponent(nextPath)}`;
    router.push(mode === 'login' ? `${LOGIN}${q}` : `${REGISTER}${q}`);
  }

  async function onAccept() {
    if (!token) return;
    if (!getAccessToken()) {
      goAuth('login');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.acceptInvitation(token);
      // Adopt team workspace with server-issued session tokens
      await api.activateWorkspace(res.membership.organizationId);
      const list = await api.listWorkspaces();
      const team = list.workspaces.find((w) => w.id === res.membership.organizationId);
      setWorkspaceName(team?.name || preview?.organizationName || 'Team workspace');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
    } finally {
      setBusy(false);
    }
  }

  const emailMismatch =
    Boolean(authed && preview && meEmail) &&
    meEmail!.trim().toLowerCase() !== preview!.email.trim().toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <GlassCard className="w-full max-w-lg p-8" hoverLift={false}>
        <p className="text-[11px] uppercase tracking-[0.24em] text-accent2">Nexora</p>
        <h1 className="font-display mt-2 text-2xl font-semibold text-white">
          You&apos;re invited to join a workspace
        </h1>

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
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-neutral-500">
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
            </dl>

            {emailMismatch && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                You are signed in as <strong>{meEmail}</strong>, but this invitation is for{' '}
                <strong>{preview.email}</strong>. Sign out and sign in with the invited email.
              </p>
            )}

            {!authed && (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-50">
                Sign in or create an account with <strong>{preview.email}</strong> to accept. The
                invitation is bound to that email identity.
              </p>
            )}

            {authed && !emailMismatch ? (
              <button
                type="button"
                disabled={busy || !preview.acceptable}
                onClick={() => void onAccept()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-[#04101f] disabled:opacity-50"
              >
                {busy ? 'Accepting…' : 'Accept Invitation'}
              </button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => goAuth('login')}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-[#04101f]"
                >
                  <LogIn size={16} />
                  Sign in to accept
                </button>
                <button
                  type="button"
                  onClick={() => goAuth('register')}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm text-white hover:bg-white/5"
                >
                  <UserPlus size={16} />
                  Create account
                </button>
              </div>
            )}

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
            <p className="text-white">
              You joined <strong>{workspaceName}</strong>. It is now in your workspace switcher.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href={APP_ROUTES.workspaceSettings}
                className="inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]"
              >
                Open workspace settings
              </Link>
              <Link
                href={APP_ROUTES.dashboard}
                className="inline-flex rounded-full border border-white/15 px-5 py-2.5 text-sm text-white"
              >
                Go to dashboard
              </Link>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

export default function InviteTokenPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">
          Loading invitation…
        </div>
      }
    >
      <InviteAcceptInner />
    </Suspense>
  );
}
