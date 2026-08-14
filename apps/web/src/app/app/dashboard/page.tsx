'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Database,
  MessageSquare,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { api, type HealthCheck, type IntegrationStatus, type ApprovalRequest } from '@/lib/api';
import { GlassCard, Reveal, StaggerGroup, fadeUp } from '@/components/motion';
import { SparkArea, WeekBars } from '@/components/charts';
import { cn } from '@/lib/utils';

const sprintPlans = {
  'Sprint 1-2': {
    title: 'Data layer and basic integrations',
    items: [
      'Set up workspace auth and OAuth token storage.',
      'Connect Slack and Jira webhooks.',
      'Build PostgreSQL metadata and vector ingestion pipeline.',
    ],
  },
  'Sprint 3-4': {
    title: 'Contextual search and hybrid RAG',
    items: [
      'Connect LLM query endpoint.',
      'Extract entities: project, user, ticket, status, client.',
      'Answer status questions with citations.',
    ],
  },
  'Sprint 5-6': {
    title: 'Action execution and approvals',
    items: [
      'Build function-calling router for Jira, Slack, Gmail.',
      'Add approval prompts for risky actions.',
      'Deploy Slack bot alongside the web command center.',
    ],
  },
};

const recentConversations = [
  { q: 'Why is Project Phoenix delayed?', time: '2m ago' },
  { q: 'Status of Acme Corp renewal', time: '19m ago' },
  { q: 'Draft client timeline email', time: '1h ago' },
];

const teamMembers = [
  { name: 'Aryav Sharma', role: 'Workspace owner', initials: 'AS' },
  { name: 'Priyanshu Gupta', role: 'Ops lead', initials: 'PG' },
  { name: 'Abhinav Garg', role: 'Engineering', initials: 'AG' },
  { name: 'Ritika Malhotra', role: 'Revenue', initials: 'RM' },
];

export default function DashboardPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSprint, setSelectedSprint] = useState<keyof typeof sprintPlans>('Sprint 3-4');
  const [greetingName, setGreetingName] = useState('there');
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const [connectedCount, setConnectedCount] = useState(0);
  const [liveAgents, setLiveAgents] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [actionTimeline, setActionTimeline] = useState<
    Array<{
      id: string;
      tool: string;
      action: string;
      status: string;
      title: string;
      outcome: string;
      url?: string;
      at?: string;
    }>
  >([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [dash, me] = await Promise.all([api.getDashboard(), api.me().catch(() => null)]);
        setPending(dash.pendingApprovals || []);
        setActionTimeline(Array.isArray(dash.actionTimeline) ? dash.actionTimeline : []);
        const tools: string[] = Array.isArray(dash.integrations)
          ? dash.integrations.map((t: string | { tool: string }) => (typeof t === 'string' ? t : t.tool))
          : [];
        const demoFallback = ['slack', 'jira', 'gmail', 'salesforce', 'notion'];
        const list = tools.length ? tools : demoFallback;
        setIntegrations(
          list.map((tool) => ({
            tool,
            status: 'active' as const,
            mode: tool === 'slack' || tool === 'notion' || tool === 'jira' ? ('live' as const) : ('mock' as const),
            availableActions: [],
          }))
        );
        setHealth({ ok: dash.health?.api ?? true, service: 'enterprise-ai-os-api' });
        setGreetingName(me?.user?.displayName || me?.user?.email || dash.workspaceName || 'there');
        setRecentChats(dash.recentConversations || []);
        const connected = dash.metrics?.connectedIntegrations ?? list.length;
        const live = dash.metrics?.liveAgents ?? list.filter((t) => t === 'slack' || t === 'notion' || t === 'jira').length;
        setConnectedCount(connected);
        setLiveAgents(live);
        setPendingCount(dash.metrics?.pendingApprovals ?? 0);
        setError(null);
      } catch (err: any) {
        setError(err.message);
        // Classic demo shell: 5 sources, Slack + Notion live
        setIntegrations(
          ['slack', 'jira', 'gmail', 'salesforce', 'notion'].map((tool) => ({
            tool,
            status: 'active' as const,
            mode: tool === 'slack' || tool === 'notion' || tool === 'jira' ? ('live' as const) : ('mock' as const),
            availableActions: [],
          }))
        );
        setConnectedCount(5);
        setLiveAgents(3);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const apiOnline = health?.ok;

  return (
    <div className="space-y-6 pb-10">
      <Reveal className="flex flex-col gap-1">
        <span className="badge w-fit border-white/10 bg-white/5 text-white">
          <span className="dot bg-accent2" /> Workspace overview
        </span>
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Good to see you, <span className="gradient-text">{greetingName}</span>.
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-neutral-400">
          Everything Nexora is watching, syncing, and proposing — organized in one live command surface.
        </p>
      </Reveal>

      {error && (
        <Reveal className="rounded-[24px] border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">
          Couldn&apos;t reach the API. Confirm <code className="rounded bg-white/5 px-1 py-0.5">npm run dev -w apps/api</code> is
          running.
          <div className="mt-1 text-xs text-neutral-400">{error}</div>
        </Reveal>
      )}

      {(pendingCount > 0 || pending.length > 0) && (
        <Reveal>
          <Link
            href="/app/approvals"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-accent/30 bg-accent/10 px-5 py-4 transition hover:border-accent/50"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 text-accent" size={18} />
              <div>
                <div className="text-sm font-semibold text-white">
                  {pendingCount || pending.length} action{(pendingCount || pending.length) === 1 ? '' : 's'} waiting for
                  Approve &amp; run
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  Human gate is your product edge — review risk, then execute live in Jira / Slack / Notion.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-[#04101f]">Open Approvals</span>
          </Link>
        </Reveal>
      )}

      <StaggerGroup className="grid auto-rows-[minmax(0,auto)] grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {/* Hero workspace card */}
        <GlassCard variant="glow" className="col-span-1 p-7 sm:col-span-2 xl:col-span-3 xl:row-span-2">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-xl">
              <span className="badge border-white/10 bg-white/5 text-white">
                <Sparkles size={12} className="text-accent2" /> System overview
              </span>
              <h2 className="font-display mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Propose → Approve → Act
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-400">
                Chat proposes work across your tools. Approvals is the control room — nothing risky ships until a human
                gates it.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/app/approvals"
                  className="group inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f] transition hover:bg-[#7db6ff]"
                >
                  Review approvals
                  <ArrowUpRight size={14} className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
                <Link
                  href="/app/chat"
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-5 py-2.5 text-sm text-neutral-200 transition hover:border-accent/40 hover:text-white"
                >
                  Open chat
                </Link>
              </div>
            </div>

            <div className="h-28 w-full shrink-0 lg:h-32 lg:w-56">
              <SparkArea color="#5b9dff" />
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Live agents', value: String(liveAgents || 0), icon: Bot },
              { label: 'Connected sources', value: String(connectedCount || integrations.length || 5), icon: Plug },
              { label: 'Pending approvals', value: String(pendingCount || pending.length), icon: ShieldCheck, accent: true },
            ].map((stat) => (
              <motion.div
                key={stat.label}
                variants={fadeUp}
                className="rounded-[22px] border border-white/10 bg-black/20 p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-[0.22em] text-neutral-500">{stat.label}</div>
                  <stat.icon size={14} className="text-neutral-500" />
                </div>
                <div className={cn('mt-3 text-2xl font-semibold', stat.accent ? 'text-accent' : 'text-white')}>
                  {loading ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-white/10" /> : stat.value}
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>

        {/* Live AI status */}
        <GlassCard className="col-span-1 p-6">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Live AI status</div>
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                apiOnline ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]' : 'bg-amber-400'
              )}
            />
          </div>
          <div className="mt-4 text-xl font-semibold text-white">
            {loading ? 'Checking…' : apiOnline ? 'Online' : healthError ? 'Disconnected' : 'Degraded'}
          </div>
          <div className="mt-1 text-xs text-neutral-500">Agent core · reasoning layer</div>
          <div className="mt-5 space-y-2.5 text-sm">
            {[
              { label: 'Chat endpoint', ok: true },
              { label: 'Agent core', ok: true },
              { label: 'Approvals queue', ok: true },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5">
                <span className="text-neutral-300">{row.label}</span>
                <CheckCircle2 size={14} className="text-emerald-400" />
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Recent conversations */}
        <GlassCard className="col-span-1 p-6">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Recent conversations</div>
            <MessageSquare size={14} className="text-neutral-500" />
          </div>
          <div className="mt-4 space-y-3">
            {(recentChats.length ? recentChats : recentConversations).map((c: any) => (
              <div key={c.id || c.q} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm text-neutral-300">
                <div className="truncate text-neutral-200">{c.title || c.q}</div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {c.updated_at ? new Date(c.updated_at).toLocaleString() : c.time}
                </div>
              </div>
            ))}
          </div>
          <Link href="/app/chat" className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:text-white">
            Open conversation log <ArrowUpRight size={12} />
          </Link>
        </GlassCard>

        {/* Approval queue */}
        <GlassCard className="col-span-1 p-6 sm:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Approval queue</div>
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-300">
              {pending.length} pending
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {pending.slice(0, 3).map((a) => (
              <div key={a.id} className="rounded-xl border border-white/8 bg-black/20 p-3">
                <div className="text-sm text-neutral-200">
                  {a.tool}.{a.action}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-neutral-500">Risk: {a.riskLevel}</div>
              </div>
            ))}
            {pending.length === 0 && !loading && (
              <div className="rounded-xl border border-white/8 bg-black/20 p-3 text-sm text-neutral-500">
                No pending approvals right now.
              </div>
            )}
          </div>
          <Link href="/app/approvals" className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:text-white">
            Review all <ArrowUpRight size={12} />
          </Link>
        </GlassCard>

        {/* Integrations overview */}
        <GlassCard className="col-span-1 p-6 sm:col-span-2 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Integrations overview</div>
            <Plug size={14} className="text-neutral-500" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(integrations.length
              ? integrations
              : ['slack', 'jira', 'gmail', 'salesforce', 'notion'].map((tool) => ({
                  tool,
                  status: 'active' as const,
                  mode: tool === 'slack' || tool === 'notion' ? ('live' as const) : ('mock' as const),
                  availableActions: [] as string[],
                }))
            ).map((item) => (
              <div
                key={item.tool}
                className="flex items-center justify-between rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm capitalize text-neutral-300"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full',
                      item.mode === 'live' ? 'bg-emerald-400' : 'bg-neutral-500'
                    )}
                  />
                  {item.tool}
                </span>
                <span
                  className={cn(
                    'text-[10px] uppercase tracking-wider',
                    item.mode === 'live' ? 'text-emerald-400' : 'text-neutral-500'
                  )}
                >
                  {item.mode === 'live' ? 'live' : 'mock'}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Analytics — weekly volume */}
        <GlassCard className="col-span-1 p-6 sm:col-span-2 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Usage analytics</div>
              <div className="mt-1 text-lg font-semibold text-white">Requests this week</div>
            </div>
            <Activity size={14} className="text-neutral-500" />
          </div>
          <div className="mt-4 h-32">
            <WeekBars color="#8be9d0" />
          </div>
        </GlassCard>

        {/* Connected services / backend health */}
        <GlassCard className="col-span-1 p-6 sm:col-span-2 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Backend health</div>
            <Database size={14} className="text-neutral-500" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              { label: 'API', ok: apiOnline ?? true },
              { label: 'Postgres', ok: true },
              { label: 'MongoDB', ok: true },
              { label: 'Notion sync', ok: true },
            ].map((svc) => (
              <div key={svc.label} className="flex items-center justify-between rounded-xl border border-white/8 bg-black/20 px-3.5 py-2.5 text-sm">
                <span className="text-neutral-300">{svc.label}</span>
                <span className={cn('h-2 w-2 rounded-full', svc.ok ? 'bg-emerald-400' : 'bg-rose-400')} />
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Team members */}
        <GlassCard className="col-span-1 p-6">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Team</div>
            <Users size={14} className="text-neutral-500" />
          </div>
          <div className="mt-4 space-y-3">
            {teamMembers.map((m) => (
              <div key={m.name} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/50 to-violet/50 text-[11px] font-semibold text-white">
                  {m.initials}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm text-neutral-200">{m.name}</div>
                  <div className="truncate text-[11px] text-neutral-500">{m.role}</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Real Action Timeline — decided Approve & run outcomes */}
        <GlassCard className="col-span-1 p-6 sm:col-span-2 xl:col-span-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Action Timeline</div>
            <Link href="/app/approvals" className="text-[11px] text-accent hover:underline">
              Open Approvals
            </Link>
          </div>
          <div className="mt-5 space-y-0">
            {actionTimeline.length === 0 && !loading && (
              <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-5 text-sm text-neutral-400">
                No decided actions yet. Propose work in Chat → Approve &amp; run — outcomes land here (not a fake feed).
              </div>
            )}
            {actionTimeline.map((e, i) => (
              <div key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
                {i !== actionTimeline.length - 1 && (
                  <span className="absolute left-[5px] top-3 h-full w-px bg-white/10" />
                )}
                <span
                  className={cn(
                    'relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                    e.status === 'done' && 'bg-accent2',
                    e.status === 'failed' && 'bg-amber',
                    e.status === 'rejected' && 'bg-rose-400'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-neutral-200">
                    {e.tool}.{e.action}
                    {e.url ? (
                      <>
                        {' · '}
                        <a href={e.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          {e.outcome}
                        </a>
                      </>
                    ) : (
                      <span className="text-neutral-400"> · {e.outcome}</span>
                    )}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                    {e.status}
                    {e.at ? ` · ${new Date(e.at).toLocaleString()}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </StaggerGroup>

      {/* MVP roadmap */}
      <GlassCard className="p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Phased MVP roadmap</div>
            <div className="font-display mt-1 text-xl font-semibold text-white">Nexora build plan</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(sprintPlans).map((tab) => (
              <button
                key={tab}
                onClick={() => setSelectedSprint(tab as keyof typeof sprintPlans)}
                className={cn(
                  'rounded-full px-4 py-2 text-xs font-semibold transition',
                  selectedSprint === tab ? 'bg-accent text-[#04101f]' : 'bg-white/5 text-neutral-300 hover:bg-white/10'
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <motion.div
          key={selectedSprint}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mt-6 rounded-[24px] border border-white/10 bg-black/20 p-6"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-accent">{selectedSprint}</div>
              <div className="mt-1 text-lg font-semibold text-white">{sprintPlans[selectedSprint].title}</div>
            </div>
            <span className="w-fit rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs text-accent">
              In progress
            </span>
          </div>
          <ul className="mt-5 space-y-2.5 text-sm text-neutral-300">
            {sprintPlans[selectedSprint].items.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </motion.div>
      </GlassCard>
    </div>
  );
}
