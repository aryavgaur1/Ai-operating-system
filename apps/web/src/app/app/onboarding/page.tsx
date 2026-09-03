'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, oauthConnectUrl } from '@/lib/api';
import { APP_ROUTES } from '@/lib/routes';

const STEPS = ['Workspace', 'Profile', 'Gmail', 'Notion', 'Slack', 'Jira', 'Finish'] as const;
const ONBOARDING_RETURN = '/app/onboarding' as const;

const TOOL_STEP: Record<string, number> = {
  gmail: 2,
  notion: 3,
  slack: 4,
  jira: 5,
};

function clampStep(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(STEPS.length - 1, Math.floor(v)));
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [slackUrl, setSlackUrl] = useState<string | null>(null);
  const [notionUrl, setNotionUrl] = useState<string | null>(null);
  const [jiraUrl, setJiraUrl] = useState<string | null>(null);
  const [gmailUrl, setGmailUrl] = useState<string | null>(null);
  const [slackConnected, setSlackConnected] = useState(false);
  const [notionConnected, setNotionConnected] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [notionToken, setNotionToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(0);
  stepRef.current = step;

  const refreshIntegrations = useCallback(async () => {
    const res = await api.listIntegrations();
    const slack = res.tools.find((t) => t.tool === 'slack');
    const notion = res.tools.find((t) => t.tool === 'notion');
    const jira = res.tools.find((t) => t.tool === 'jira');
    const gmail = res.tools.find((t) => t.tool === 'gmail');
    setSlackConnected(slack?.status === 'active');
    setNotionConnected(notion?.status === 'active');
    setJiraConnected(jira?.status === 'active');
    setGmailConnected(gmail?.status === 'active');
    setSlackUrl(oauthConnectUrl('slack', ONBOARDING_RETURN) || slack?.connectUrl || null);
    setNotionUrl(oauthConnectUrl('notion', ONBOARDING_RETURN) || notion?.connectUrl || null);
    setJiraUrl(oauthConnectUrl('jira', ONBOARDING_RETURN) || jira?.connectUrl || null);
    setGmailUrl(oauthConnectUrl('gmail', ONBOARDING_RETURN) || gmail?.connectUrl || null);
  }, []);

  const persistProgress = useCallback(
    async (nextStep: number, draft?: { workspaceName?: string; displayName?: string; avatarUrl?: string }) => {
      const ws = draft?.workspaceName ?? workspaceName;
      const dn = draft?.displayName ?? displayName;
      const av = draft?.avatarUrl ?? avatarUrl;
      try {
        await api.updateMe({
          displayName: dn || undefined,
          avatarUrl: av || undefined,
          preferences: {
            onboardingStep: nextStep,
            onboardingDraft: {
              workspaceName: ws,
              displayName: dn,
              avatarUrl: av,
            },
          },
        });
      } catch {
        // Non-blocking — OAuth return still uses JWT returnTo; draft may be incomplete briefly.
      }
    },
    [workspaceName, displayName, avatarUrl]
  );

  const schedulePersist = useCallback(
    (nextStep: number) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        void persistProgress(nextStep);
      }, 400);
    },
    [persistProgress]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.me();
        if (cancelled) return;
        if (res.profile?.preferences?.onboardingCompleted) {
          router.replace('/app/dashboard');
          return;
        }

        const draft = res.profile?.preferences?.onboardingDraft || {};
        const restoredName =
          (typeof draft.displayName === 'string' && draft.displayName) ||
          res.user.displayName ||
          '';
        const restoredWorkspace =
          (typeof draft.workspaceName === 'string' && draft.workspaceName) ||
          res.workspace?.name ||
          '';
        const restoredAvatar =
          (typeof draft.avatarUrl === 'string' && draft.avatarUrl) ||
          res.profile?.avatar_url ||
          '';

        setDisplayName(restoredName);
        setWorkspaceName(restoredWorkspace);
        setAvatarUrl(restoredAvatar);

        let restoredStep = clampStep(res.profile?.preferences?.onboardingStep);
        const connectedParam = searchParams.get('connected');
        if (connectedParam && TOOL_STEP[connectedParam] !== undefined) {
          restoredStep = TOOL_STEP[connectedParam];
        }
        setStep(restoredStep);
        // Persist the OAuth-return step so refresh/reopen stays correct.
        if (connectedParam && TOOL_STEP[connectedParam] !== undefined) {
          void api.updateMe({
            preferences: {
              onboardingStep: restoredStep,
              onboardingDraft: {
                workspaceName: restoredWorkspace,
                displayName: restoredName,
                avatarUrl: restoredAvatar,
              },
            },
          }).catch(() => undefined);
        }

        const oauthError = searchParams.get('error');
        if (oauthError) setError(decodeURIComponent(oauthError));

        await refreshIntegrations();

        // Drop one-shot OAuth query params so refresh keeps persisted step, not sticky overrides.
        if (typeof window !== 'undefined' && (connectedParam || oauthError)) {
          window.history.replaceState({}, '', APP_ROUTES.onboarding);
        }
      } catch {
        if (!cancelled) router.replace('/login');
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [router, searchParams, refreshIntegrations]);

  async function startOAuth(tool: 'gmail' | 'notion' | 'slack' | 'jira', url: string | null) {
    setError(null);
    await persistProgress(stepRef.current);
    const href = oauthConnectUrl(tool, ONBOARDING_RETURN) || url;
    if (!href) {
      setError(`${tool[0].toUpperCase()}${tool.slice(1)} OAuth is not configured on the server yet`);
      return;
    }
    window.location.href = href;
  }

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

  function goToStep(next: number) {
    const clamped = clampStep(next);
    setStep(clamped);
    schedulePersist(clamped);
  }

  function next(e?: FormEvent) {
    e?.preventDefault();
    if (step < STEPS.length - 1) goToStep(step + 1);
    else finish();
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass w-full max-w-lg rounded-[28px] p-8 text-sm text-neutral-400">Loading setup…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-lg rounded-[28px] p-8">
        <div className="text-[11px] uppercase tracking-[0.2em] text-accent2">Setup</div>
        <h1 className="font-display mt-3 text-2xl font-semibold text-white sm:text-3xl">
          {displayName.trim()
            ? `Hi ${displayName.trim().split(/\s+/)[0]}, I'm Nexora`
            : "Hi, I'm Nexora"}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          How can I assist you? Connect Gmail, Slack, Notion, and Jira with your own accounts — never shared with other
          workspaces.
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
                  onChange={(e) => {
                    setWorkspaceName(e.target.value);
                    schedulePersist(step);
                  }}
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
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    schedulePersist(step);
                  }}
                  placeholder="Your name"
                />
              </label>
              <label className="block text-xs text-neutral-500">
                Avatar URL (optional)
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm"
                  value={avatarUrl}
                  onChange={(e) => {
                    setAvatarUrl(e.target.value);
                    schedulePersist(step);
                  }}
                  placeholder="https://…"
                />
              </label>
            </>
          )}

          {step === 2 && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-white">Connect Gmail</div>
              <p className="mt-1 text-xs text-neutral-400">
                Optional — grants Nexora permission to <strong className="text-neutral-300">read</strong> your mail and{' '}
                <strong className="text-neutral-300">send</strong> when you approve. Tokens stay encrypted on the server.
              </p>
              {gmailConnected ? (
                <div className="mt-3 text-sm text-emerald-300">Gmail connected</div>
              ) : (
                <button
                  type="button"
                  className="mt-4 rounded-full bg-accent/25 px-4 py-2 text-sm text-white"
                  onClick={() => startOAuth('gmail', gmailUrl)}
                >
                  Connect Gmail
                </button>
              )}
            </div>
          )}

          {step === 3 && (
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
                    onClick={() => startOAuth('notion', notionUrl)}
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
                          await persistProgress(step);
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

          {step === 4 && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-white">Connect Slack</div>
              <p className="mt-1 text-xs text-neutral-400">Optional — installs into your Slack workspace only.</p>
              {slackConnected ? (
                <div className="mt-3 text-sm text-emerald-300">Slack connected</div>
              ) : (
                <button
                  type="button"
                  className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm text-white"
                  onClick={() => startOAuth('slack', slackUrl)}
                >
                  Connect Slack
                </button>
              )}
            </div>
          )}

          {step === 5 && (
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
                  onClick={() => startOAuth('jira', jiraUrl)}
                >
                  Connect Jira
                </button>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-2 text-sm text-neutral-300">
              <p>You&apos;re ready. Your chats, approvals, and integrations stay private to this account.</p>
              <ul className="list-disc space-y-1 pl-5 text-neutral-400">
                <li>Workspace: {workspaceName || 'Personal'}</li>
                <li>Gmail: {gmailConnected ? 'Connected' : 'Skipped for now'}</li>
                <li>Notion: {notionConnected ? 'Connected' : 'Skipped for now'}</li>
                <li>Slack: {slackConnected ? 'Connected' : 'Skipped for now'}</li>
                <li>Jira: {jiraConnected ? 'Connected' : 'Skipped for now'}</li>
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            {step > 0 && (
              <button type="button" onClick={() => goToStep(step - 1)} className="rounded-full border border-white/10 px-4 py-2.5 text-sm text-neutral-300">
                Back
              </button>
            )}
            <button type="submit" disabled={loading} className="min-w-[7rem] flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {loading
                ? 'Saving…'
                : step === STEPS.length - 1
                  ? 'Finish setup'
                  : step >= 2 && step <= 5
                    ? 'Continue'
                    : 'Next'}
            </button>
            {step >= 2 && step <= 5 && (
              <button type="button" onClick={() => goToStep(step + 1)} className="rounded-full border border-white/10 px-4 py-2.5 text-sm text-neutral-400">
                Skip
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
