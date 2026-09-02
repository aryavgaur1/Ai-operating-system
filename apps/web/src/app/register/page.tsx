'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, googleLoginUrl, setAccessToken } from '@/lib/api';
import { isSafeNextPath } from '@/lib/routes';

function RegisterInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const data = await api.signup({ email, password, confirmPassword, displayName, workspaceName });
      setAccessToken(data.accessToken || data.token);
      const next = search.get('next');
      router.replace(isSafeNextPath(next) ? next! : '/app/dashboard');
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  const next = search.get('next');
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-md rounded-[28px] p-8">
        <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Nexora OS</div>
        <h1 className="font-display mt-3 text-3xl font-semibold text-white">Create account</h1>
        <p className="mt-2 text-sm text-neutral-400">Your own workspace, chat, approvals, and integrations.</p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
            placeholder="Personal workspace name (optional)"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
            type="password"
            placeholder="Password (8+)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <a
          href={googleLoginUrl(next)}
          className="mt-3 flex w-full items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-200"
        >
          Continue with Google
        </a>
        <p className="mt-4 text-center text-xs text-neutral-500">
          Already have an account?{' '}
          <Link href={loginHref} className="text-neutral-200 hover:text-white">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">
          Loading…
        </div>
      }
    >
      <RegisterInner />
    </Suspense>
  );
}
