'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Palette, ShieldCheck, User } from 'lucide-react';
import { GlassCard, Reveal, StaggerGroup } from '@/components/motion';
import { cn } from '@/lib/utils';
import { api, setAccessToken } from '@/lib/api';

const POLICY_CARDS = [
  {
    id: 'strict_human_gate',
    name: 'Strict human gate',
    description: 'Every Slack / Notion / Jira write waits for Approve & run. Default for serious teams.',
  },
  {
    id: 'ops_fast_lane',
    name: 'Ops fast lane',
    description: 'Still gates deletes and external posts; Notion page creates can auto-run for trusted ops.',
  },
  {
    id: 'read_mostly',
    name: 'Read-mostly',
    description: 'Maximum caution — no auto-approve exceptions on high-consequence writes.',
  },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifPush, setNotifPush] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [workspace, setWorkspace] = useState('Workspace');
  const [message, setMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [approvalPolicy, setApprovalPolicy] = useState<(typeof POLICY_CARDS)[number]['id']>('strict_human_gate');

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setDisplayName(res.user.displayName || '');
        setEmail(res.user.email);
        setRole(res.user.role);
        setWorkspace(res.workspace?.name || 'Workspace');
        const prefs = res.profile?.preferences || {};
        if (typeof prefs.notifEmail === 'boolean') setNotifEmail(prefs.notifEmail);
        if (typeof prefs.notifPush === 'boolean') setNotifPush(prefs.notifPush);
        if (typeof prefs.compactMode === 'boolean') setCompactMode(prefs.compactMode);
        if (
          prefs.approvalPolicy === 'strict_human_gate' ||
          prefs.approvalPolicy === 'ops_fast_lane' ||
          prefs.approvalPolicy === 'read_mostly'
        ) {
          setApprovalPolicy(prefs.approvalPolicy);
        }
      })
      .catch(() => undefined);
    api.loginHistory().then((r) => setHistory(r.history || [])).catch(() => undefined);
  }, []);

  async function saveProfile() {
    await api.updateMe({
      displayName,
      preferences: { notifEmail, notifPush, compactMode, approvalPolicy },
    });
    setMessage('Profile saved');
  }

  async function savePolicy(id: (typeof POLICY_CARDS)[number]['id']) {
    setApprovalPolicy(id);
    await api.updateMe({
      displayName,
      preferences: { notifEmail, notifPush, compactMode, approvalPolicy: id },
    });
    setMessage(`Approval policy set to ${POLICY_CARDS.find((p) => p.id === id)?.name}`);
  }

  async function changePassword() {
    await api.changePassword({ currentPassword, newPassword });
    setCurrentPassword('');
    setNewPassword('');
    setMessage('Password updated');
  }

  async function signOut() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAccessToken(null);
    router.push('/login');
  }

  const initials = (displayName || email || 'U')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6 pb-10">
      <Reveal>
        <GlassCard variant="glow" className="p-7" hoverLift={false}>
          <span className="badge border-white/10 bg-white/5 text-white">
            <User size={12} className="text-accent2" /> Account
          </span>
          <h1 className="font-display mt-4 text-3xl font-semibold text-white sm:text-4xl">Settings</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-400">
            Manage your profile, workspace, and notification preferences.
          </p>
          {message && <div className="mt-3 text-sm text-emerald-300">{message}</div>}
        </GlassCard>
      </Reveal>

      <StaggerGroup className="grid gap-5 lg:grid-cols-2">
        <GlassCard className="p-6 lg:col-span-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-neutral-500">
            <ShieldCheck size={13} /> Trust layer · approval policy
          </div>
          <p className="mt-2 max-w-3xl text-sm text-neutral-400">
            This is the product edge vs ChatGPT: writes pause for a human gate. Pick how strict your workspace is.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {POLICY_CARDS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => savePolicy(p.id)}
                className={cn(
                  'rounded-2xl border px-4 py-4 text-left transition',
                  approvalPolicy === p.id
                    ? 'border-accent/50 bg-accent/10'
                    : 'border-white/10 bg-black/20 hover:border-white/20'
                )}
              >
                <div className="text-sm font-semibold text-white">{p.name}</div>
                <div className="mt-2 text-xs leading-5 text-neutral-400">{p.description}</div>
                {approvalPolicy === p.id && (
                  <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-accent">Active</div>
                )}
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-neutral-500">
            <User size={13} /> Profile
          </div>
          <div className="mt-5 flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent/60 to-violet/60 text-lg font-semibold text-white">
              {initials}
            </span>
            <div>
              <div className="text-lg font-semibold text-white">{displayName || email}</div>
              <div className="text-sm text-neutral-500">{role.replace('_', ' ')}</div>
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">Full name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent/50"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">Email</span>
              <input
                value={email}
                disabled
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-neutral-400 outline-none"
              />
            </label>
            <button onClick={saveProfile} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white">
              Save profile
            </button>
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-neutral-500">
            <ShieldCheck size={13} /> Workspace
          </div>
          <div className="mt-5 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-black/20 px-3.5 py-2.5">
              <span className="text-neutral-300">Workspace name</span>
              <span className="text-neutral-500">{workspace}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-black/20 px-3.5 py-2.5">
              <span className="text-neutral-300">Plan</span>
              <span className="text-neutral-500">Personal SaaS</span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">Current password</span>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-neutral-500">New password</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm" />
            </label>
            <button onClick={changePassword} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white">
              Change password
            </button>
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-neutral-500">
            <Bell size={13} /> Notifications
          </div>
          <div className="mt-5 space-y-3">
            {[
              { label: 'Email alerts', value: notifEmail, set: setNotifEmail },
              { label: 'Push notifications', value: notifPush, set: setNotifPush },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => item.set(!item.value)}
                className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-black/20 px-3.5 py-3 text-sm"
              >
                <span className="text-neutral-300">{item.label}</span>
                <span className={cn('h-5 w-9 rounded-full border transition', item.value ? 'border-accent/40 bg-accent/30' : 'border-white/10 bg-white/5')}>
                  <span className={cn('mt-0.5 block h-3.5 w-3.5 rounded-full bg-white transition', item.value ? 'ml-4' : 'ml-1')} />
                </span>
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-neutral-500">
            <Palette size={13} /> Appearance / sessions
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <button
              onClick={() => setCompactMode(!compactMode)}
              className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-black/20 px-3.5 py-3"
            >
              <span className="text-neutral-300">Compact mode</span>
              <span className={cn('h-5 w-9 rounded-full border transition', compactMode ? 'border-accent/40 bg-accent/30' : 'border-white/10 bg-white/5')}>
                <span className={cn('mt-0.5 block h-3.5 w-3.5 rounded-full bg-white transition', compactMode ? 'ml-4' : 'ml-1')} />
              </span>
            </button>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {history.slice(0, 8).map((h) => (
                <div key={h.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-neutral-400">
                  {h.success ? 'OK' : 'FAIL'} · {h.browser} · {h.ip} · {new Date(h.created_at).toLocaleString()}
                </div>
              ))}
              {!history.length && <div className="text-xs text-neutral-500">No login history yet.</div>}
            </div>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-2 rounded-full border border-rose-400/30 px-4 py-2 text-xs text-rose-300"
            >
              <LogOut size={13} /> Sign out
            </button>
            <button
              onClick={async () => {
                const pw = window.prompt('Type your password to permanently delete this account');
                if (!pw) return;
                if (!window.confirm('Delete your account and workspace data? This cannot be undone.')) return;
                try {
                  await api.deleteAccount(pw);
                  setAccessToken(null);
                  router.push('/login');
                } catch (err: any) {
                  setMessage(err.message);
                }
              }}
              className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 px-4 py-2 text-xs text-rose-200"
            >
              Delete account
            </button>
          </div>
        </GlassCard>
      </StaggerGroup>
    </div>
  );
}
