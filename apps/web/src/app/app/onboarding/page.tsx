'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const STEPS = ['Workspace', 'Profile', 'Notion', 'Slack', 'Jira', 'Finish'] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [slackUrl, setSlackUrl] = useState<string | null>(null);
  const [notionUrl, setNotionUrl] = useState<string | null>(null);
  const [jiraUrl, setJiraUrl] = useState<string | null>(null);
  const [slackConnected, setSlackConnected] = useState(false);
  const [notionConnected, setNotionConnected] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [notionToken, setNotionToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setDisplayName(res.user.displayName || '');
        setWorkspaceName(res.workspace?.name || '');
        setAvatarUrl(res.profile?.avatar_url || '');
        if (res.profile?.preferences?.onboardingCompleted) {
          router.replace('/app/dashboard');
        }
      })
      .catch(() => router.replace('/login'));

    api
      .listIntegrations()
      .then((res) => {
        const slack = res.tools.find((t) => t.tool === 'slack');
        const notion = res.tools.find((t) => t.tool === 'notion');
        const jira = res.tools.find((t) => t.tool === 'jira');
        setSlackConnected(slack?.status === 'active');
        setNotionConnected(notion?.status === 'active');
        setJiraConnected(jira?.status === 'active');
        setSlackUrl(slack?.connectUrl || null);
        setNotionUrl(notion?.connectUrl || null);
        setJiraUrl(jira?.connectUrl || null);
      })
      .catch(() => undefined);
  }, [router]);

  async function finish() {
    setLoading(true);
    setError(null);
    try {
      await api.completeOnboarding({ workspaceName, displayName, avatarUrl: avatarUrl || undefined });
      router.replace('/app/dashboard');
    } catch (err: any) {
      setError(err.message || 'Could not finish setup');
    } finally {
      setLoading(false);
    }
  }

  function next(e?: FormEvent) {
    e?.preventDefault();
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-lg rounded-[28px] p-8">
        <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Setup</div>
        <h1 className="font-display mt-3 text-3xl font-semibold text-white">Welcome to your workspace</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Every user gets a private workspace. Connect <em>your</em> Notion, Slack, and Jira — never shared with other
          accounts.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`rounded-full border px-3 py-1 text-[11px] ${
                i === step ? 'border-accent/40 bg-accent/20 text-white' : 'border-white/10 text-neutral-500'
              }`}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

        <form onSubmit={next} className="mt-6 space-y-4">
          {step === 0 && (
            <>
              <label className="block text-xs text-neutral-500">
                Workspace name
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Acme Ops"
                  required
                />
              </label>
              <p className="text-xs text-neutral-500">Created automatically at signup — rename it here if you want.</p>
            </>
          )}

          {step === 1 && (
            <>
              <label className="block text-xs text-neutral-500">
                Display name
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="block text-xs text-neutral-500">
                Avatar URL (optional)
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://…"
                />
              </label>
            </>
          )}

          {step === 2 && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-white">Connect Notion</div>
              <p className="mt-1 text-xs text-neutral-400">Optional — one-click OAuth into your Notion workspace only.</p>
              {notionConnected ? (
                <div className="mt-3 text-sm text-emerald-300">Notion connected</div>
              ) : (
                <>
                  <button
                    type="button"
                    className="mt-4 rounded-full bg-accent/25 px-4 py-2 text-sm text-white"
                    onClick={() => {
                      if (notionUrl) window.location.href = notionUrl;
                      else setError('Notion OAuth is not configured on the server yet');
                    }}
                  >
                    Connect Notion
                  </button>
                  <details className="mt-4 text-xs text-neutral-500">
                    <summary className="cursor-pointer text-neutral-400">Having trouble with Allow? (dev only)</summary>
                    <p className="mt-2 text-neutral-500">
                      Requires server flag <code className="text-neutral-300">ALLOW_NOTION_TOKEN_PASTE=true</code>. Customers
                      should use Connect Notion only.
                    </p>
                    <label className="mt-3 block">
                      Paste Internal Integration secret (dev fallback)
                      <input
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white"
                        value={notionToken}
                        onChange={(e) => setNotionToken(e.target.value)}
                        placeholder="secret_… or ntn_…"
                        autoComplete="off"
                      />
                    </label>
                    <button
                      type="button"
                      className="mt-3 rounded-full bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-40"
                      disabled={!notionToken.trim() || loading}
                      onClick={async () => {
                        setLoading(true);
                        setError(null);
                        try {
                          await api.connectNotionToken(notionToken.trim());
                          setNotionConnected(true);
                          setNotionToken('');
                        } catch (err: any) {
                          setError(err.message || 'Could not connect Notion token');
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Save Notion token
                    </button>
                  </details>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-white">Connect Slack</div>
              <p className="mt-1 text-xs text-neutral-400">Optional — installs into your Slack workspace only.</p>
              {slackConnected ? (
                <div className="mt-3 text-sm text-emerald-300">Slack connected</div>
              ) : (
                <button
                  type="button"
                  className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm text-white"
                  onClick={() => {
                    if (slackUrl) window.location.href = slackUrl;
                    else setError('Slack OAuth is not configured on the server yet');
                  }}
                >
                  Connect Slack
                </button>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-white">Connect Jira</div>
              <p className="mt-1 text-xs text-neutral-400">
                Optional — connect your Atlassian Jira Cloud site so Chat can create and update tickets.
              </p>
              {jiraConnected ? (
                <div className="mt-3 text-sm text-emerald-300">Jira connected</div>
              ) : (
                <button
                  type="button"
                  className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm text-white"
                  onClick={() => {
                    if (jiraUrl) window.location.href = jiraUrl;
                    else setError('Jira OAuth is not configured on the server yet');
                  }}
                >
                  Connect Jira
                </button>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-2 text-sm text-neutral-300">
              <p>You&apos;re ready. Your chats, approvals, and integrations stay private to this account.</p>
              <ul className="list-disc space-y-1 pl-5 text-neutral-400">
                <li>Workspace: {workspaceName || 'Personal'}</li>
                <li>Notion: {notionConnected ? 'Connected' : 'Skipped for now'}</li>
                <li>Slack: {slackConnected ? 'Connected' : 'Skipped for now'}</li>
                <li>Jira: {jiraConnected ? 'Connected' : 'Skipped for now'}</li>
              </ul>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep((s) => s - 1)} className="rounded-full border border-white/10 px-4 py-2.5 text-sm text-neutral-300">
                Back
              </button>
            )}
            <button type="submit" disabled={loading} className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {loading
                ? 'Saving…'
                : step === STEPS.length - 1
                  ? 'Finish setup'
                  : step === 2 || step === 3 || step === 4
                    ? 'Continue'
                    : 'Next'}
            </button>
            {(step === 2 || step === 3 || step === 4) && (
              <button type="button" onClick={() => setStep((s) => s + 1)} className="rounded-full border border-white/10 px-4 py-2.5 text-sm text-neutral-400">
                Skip
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
