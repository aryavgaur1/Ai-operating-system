'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plug } from 'lucide-react';
import { api, type IntegrationStatus } from '@/lib/api';
import { GlassCard, Reveal } from '@/components/motion';
import { cn } from '@/lib/utils';

type ToolId = 'slack' | 'jira' | 'gmail' | 'salesforce' | 'notion';

const CATALOG: Array<{
  tool: ToolId;
  label: string;
  description: string;
  actions: string[];
}> = [
  {
    tool: 'slack',
    label: 'Slack',
    description: 'Real-time messages, channels, mentions, and webhook events.',
    actions: ['send_message', 'read_channel', 'create_channel'],
  },
  {
    tool: 'jira',
    label: 'Jira',
    description: 'Issues, epics, sprint status, blockers, ownership, and updates.',
    actions: ['create_ticket', 'update_status'],
  },
  {
    tool: 'gmail',
    label: 'Gmail',
    description: 'Email threads, drafts, customer updates, and summaries.',
    actions: ['send_email', 'read_thread'],
  },
  {
    tool: 'salesforce',
    label: 'Salesforce',
    description: 'Accounts, opportunities, contacts, fields, and timeline events.',
    actions: ['update_record', 'read_account'],
  },
  {
    tool: 'notion',
    label: 'Notion',
    description: 'Docs, launch plans, meeting notes, policies, and knowledge base.',
    actions: ['read_page', 'create_page', 'update_page'],
  },
];

function SlackLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#E01E5A" d="M5.1 15.2a2.05 2.05 0 1 1-2.05-2.05h2.05v2.05Z" />
      <path fill="#E01E5A" d="M6.15 15.2a2.05 2.05 0 1 1 4.1 0v5.13a2.05 2.05 0 1 1-4.1 0V15.2Z" />
      <path fill="#36C5F0" d="M8.8 5.1A2.05 2.05 0 1 1 10.85 3.05V5.1H8.8Z" />
      <path fill="#36C5F0" d="M8.8 6.15a2.05 2.05 0 1 1 0 4.1H3.67a2.05 2.05 0 1 1 0-4.1H8.8Z" />
      <path fill="#2EB67D" d="M18.9 8.8a2.05 2.05 0 1 1 2.05 2.05H18.9V8.8Z" />
      <path fill="#2EB67D" d="M17.85 8.8a2.05 2.05 0 1 1-4.1 0V3.67a2.05 2.05 0 1 1 4.1 0V8.8Z" />
      <path fill="#ECB22E" d="M15.2 18.9a2.05 2.05 0 1 1-2.05 2.05V18.9H15.2Z" />
      <path fill="#ECB22E" d="M15.2 17.85a2.05 2.05 0 1 1 0-4.1h5.13a2.05 2.05 0 1 1 0 4.1H15.2Z" />
    </svg>
  );
}

function NotionLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#fff"
        d="M4.5 4.2c.35-.3.85-.45 1.55-.45h11.2c.3 0 .55.05.75.15l.35.2.2.25v14.8c0 .35-.1.65-.3.9-.2.25-.5.4-.9.45l-10.7 1.55c-.1.02-.2.02-.3.02-.45 0-.8-.15-1.05-.45-.25-.3-.4-.7-.4-1.15V5.1c0-.4.15-.7.4-.9Zm2.2 1.55v11.85l8.85-1.25V5.75H6.7Zm2.15 1.9h1.35v7.4H8.85v-7.4Zm3.1 0h4.2v1.15h-2.85v1.85h2.55v1.1h-2.55v3.3h-1.35v-7.4Z"
      />
    </svg>
  );
}

function GmailLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#EA4335" d="M3.5 6.5v11l4.2-3.15V9.35L3.5 6.5Z" />
      <path fill="#34A853" d="M20.5 6.5v11l-4.2-3.15V9.35L20.5 6.5Z" />
      <path fill="#FBBC04" d="M3.5 17.5 7.7 14.35 12 17.5l4.3-3.15L20.5 17.5v1.2c0 .7-.55 1.3-1.25 1.3H4.75c-.7 0-1.25-.6-1.25-1.3v-1.2Z" />
      <path fill="#C5221F" d="M20.5 6.5 12 12.5 3.5 6.5l.9-.9L12 10.7l7.6-5.1.9.9Z" />
      <path fill="#4285F4" d="M3.5 6.5 12 12.5l8.5-6V5.3c0-.7-.55-1.3-1.25-1.3H4.75C4.05 4 3.5 4.6 3.5 5.3v1.2Z" />
    </svg>
  );
}

function JiraLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#2684FF"
        d="M12.4 3H21v.2c0 3.8-3.1 6.9-6.9 6.9H12.4V3Zm-1.8 5.9H3v.2c0 3.8 3.1 6.9 6.9 6.9h1.7V8.9Zm1.8 5.9h-1.7c-3.8 0-6.9 3.1-6.9 6.9V22h8.6v-7.2Z"
      />
      <path fill="#2684FF" d="M20.2 14.8h-7.8V22H21v-.3c0-3.8-3.1-6.9-6.9-6.9h-1.1.2Z" opacity=".65" />
    </svg>
  );
}

function SalesforceLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#00A1E0"
        d="M10.2 6.4c.7-1.2 2-2 3.5-2 1.6 0 3 .9 3.7 2.2.7-.4 1.5-.6 2.3-.6 2.3 0 4.1 1.9 4.1 4.2 0 2.3-1.8 4.2-4.1 4.2h-.2c-.5 1.7-2.1 3-4 3-1 0-1.9-.3-2.6-.9-.7.9-1.8 1.5-3.1 1.5-1.4 0-2.7-.8-3.4-2-.5.2-1 .3-1.6.3-2.2 0-4-1.8-4-4 0-1.7 1.1-3.2 2.6-3.7C3.8 7.4 5.2 6.3 7 6.3c1.2 0 2.3.5 3.2 1.3l.0-.1Z"
      />
    </svg>
  );
}

const LOGOS: Record<ToolId, (props: { className?: string }) => JSX.Element> = {
  slack: SlackLogo,
  notion: NotionLogo,
  gmail: GmailLogo,
  jira: JiraLogo,
  salesforce: SalesforceLogo,
};

const DEFAULT_ENABLED: Record<ToolId, boolean> = {
  slack: true,
  jira: true,
  gmail: false,
  salesforce: true,
  notion: true,
};

function SmoothToggle({
  checked,
  busy,
  onChange,
}: {
  checked: boolean;
  busy?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        'relative h-8 w-[52px] shrink-0 rounded-full border p-0.5 transition-colors duration-300 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        checked ? 'border-accent2/50 bg-accent2' : 'border-white/15 bg-white/10',
        busy && 'cursor-wait opacity-70'
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        className="block h-6 w-6 rounded-full bg-white shadow-md"
        animate={{ x: checked ? 20 : 0 }}
        initial={false}
      />
    </button>
  );
}

export default function IntegrationsPage() {
  const [meta, setMeta] = useState<Record<string, IntegrationStatus>>({});
  const [enabled, setEnabled] = useState<Record<ToolId, boolean>>(DEFAULT_ENABLED);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ToolId | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listIntegrations()
      .then((res) => {
        if (cancelled) return;
        const nextMeta: Record<string, IntegrationStatus> = {};
        const nextEnabled = { ...DEFAULT_ENABLED };
        for (const t of res.tools) {
          nextMeta[t.tool] = t;
          if (t.tool in nextEnabled) {
            nextEnabled[t.tool as ToolId] = t.status === 'active';
          }
        }
        setMeta(nextMeta);
        setEnabled(nextEnabled);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(tool: ToolId) {
    if (busy) return;
    const turningOn = !enabled[tool];

    // Optimistic UI — never wait on API to feel the switch
    setEnabled((prev) => ({ ...prev, [tool]: turningOn }));
    setBusy(tool);
    setError(null);

    try {
      const row = meta[tool];
      if (turningOn) {
        // Real OAuth path only when SaaS mode exposes a connect URL
        if (row?.canConnect && row.connectUrl) {
          window.location.href = row.connectUrl;
          return;
        }
        // Demo / mock: keep local ON (already set)
      } else {
        // Best-effort disconnect; demo API may still report active — local state wins
        try {
          await api.disconnectIntegration(tool);
        } catch {
          // ignore — UI already reflects OFF
        }
      }
    } catch (err: any) {
      // Revert only on hard failure of the toggle itself
      setEnabled((prev) => ({ ...prev, [tool]: !turningOn }));
      setError(err.message || 'Could not update integration');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <Reveal>
        <GlassCard variant="glow" className="p-7" hoverLift={false}>
          <span className="badge border-white/10 bg-white/5 text-white">
            <Plug size={12} className="text-accent2" /> Connected services
          </span>
          <h1 className="font-display mt-4 text-3xl font-semibold text-white sm:text-4xl">Integrations</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-400">
            Toggle connectors on or off. Slack and Notion can run live from workspace credentials; others stay ready
            for OAuth when you enable SaaS mode.
          </p>
        </GlassCard>
      </Reveal>

      {error && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      )}

      <GlassCard className="p-6 sm:p-7" hoverLift={false}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-accent sm:text-2xl">Integration framework</h2>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-neutral-400">
            OAuth + RBAC
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {CATALOG.map((item) => {
            const active = enabled[item.tool];
            const Logo = LOGOS[item.tool];
            const mode = meta[item.tool]?.mode ?? 'mock';
            return (
              <motion.div
                key={item.tool}
                layout
                initial={false}
                animate={{ opacity: hydrated ? 1 : 0.85 }}
                className="flex items-center gap-4 rounded-2xl border border-white/8 bg-black/25 px-4 py-4 transition-colors duration-300 hover:border-white/15"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2.5">
                  <Logo className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-display text-base font-semibold text-white">{item.label}</div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors duration-300',
                        active ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/5 text-neutral-500'
                      )}
                    >
                      {active ? 'Online' : 'Offline'}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-neutral-600">{mode}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-neutral-400">{item.description}</p>
                </div>
                <SmoothToggle
                  checked={active}
                  busy={busy === item.tool}
                  onChange={() => toggle(item.tool)}
                />
              </motion.div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
