'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, googleLoginUrl, setAccessToken } from '@/lib/api';

export default function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [loading, setLoading] = useState(false);
  const resetToken = search.get('reset');

  useEffect(() => {
    if (resetToken) setMode('reset');
    if (search.get('mode') === 'forgot') setMode('forgot');
    const verify = search.get('verify');
    if (verify) {
      api
        .verifyEmail(verify)
        .then(() => setInfo('Email verified. You can sign in.'))
        .catch((e) => setError(e.message));
    }
    const oauthError = search.get('error');
    if (oauthError) {
      setError(oauthError);
    }
  }, [resetToken, search]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'forgot') {
        await api.forgotPassword(email);
        setInfo('If that email exists, a reset link was sent.');
        setMode('login');
        return;
      }
      if (mode === 'reset') {
        await api.resetPassword(resetToken || '', password);
        setInfo('Password updated. Sign in with your new password.');
        setMode('login');
        return;
      }
      const data = await api.login({ email, password, rememberMe });
      setAccessToken(data.accessToken || data.token);
      const next = search.get('next');
      router.replace(next && next.startsWith('/app') ? next : '/app/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-md rounded-[28px] p-8">
        <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Nexora OS</div>
        <h1 className="font-display mt-3 text-3xl font-semibold text-white">
          {mode === 'forgot' ? 'Forgot password' : mode === 'reset' ? 'Reset password' : 'Sign in'}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">Access your private workspace and integrations.</p>

        {error && <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        {info && <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-300">{info}</div>}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {mode !== 'reset' && (
            <div>
              <label className="text-xs text-neutral-500">Email</label>
              <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-accent/40" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          )}
          {mode !== 'forgot' && (
            <div>
              <label className="text-xs text-neutral-500">Password</label>
              <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-accent/40" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
          )}
          {mode === 'login' && (
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              Remember me
            </label>
          )}
          <button type="submit" disabled={loading} className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? 'Please wait…' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}
          </button>
        </form>

        {mode === 'login' && (
          <>
            <a href={googleLoginUrl()} className="mt-3 flex w-full items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-200">
              Continue with Google
            </a>
            <div className="mt-4 flex justify-between text-xs text-neutral-500">
              <button type="button" className="hover:text-white" onClick={() => setMode('forgot')}>Forgot password?</button>
              <Link href="/register" className="hover:text-white">Create account</Link>
            </div>
          </>
        )}
        {mode !== 'login' && (
          <button type="button" className="mt-4 text-xs text-neutral-500 hover:text-white" onClick={() => setMode('login')}>
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
