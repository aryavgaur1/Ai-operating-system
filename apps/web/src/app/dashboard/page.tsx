'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type IntegrationStatus, type ApprovalRequest } from '@/lib/api';

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

export default function DashboardPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSprint, setSelectedSprint] = useState<keyof typeof sprintPlans>('Sprint 3-4');
  const [selectedSection, setSelectedSection] = useState<'overview' | 'chat' | 'approvals' | 'integrations' | 'roadmap'>('overview');

  const sections = [
    { id: 'overview', label: 'Command Center' },
    { id: 'chat', label: 'Chat' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'roadmap', label: 'MVP Roadmap' },
  ] as const;

  const navigateSection = (id: typeof sections[number]['id']) => {
    setSelectedSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0));
        if (visible.length > 0) {
          setSelectedSection(visible[0].target.id as typeof sections[number]['id']);
        }
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: [0.2, 0.5, 0.8] }
    );

    document.querySelectorAll('section[id]').forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    Promise.all([api.listIntegrations(), api.listApprovals('pending')])
      .then(([integrationsRes, approvalsRes]) => {
        setIntegrations(integrationsRes.tools);
        setPending(approvalsRes.approvals);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="grid gap-8 xl:grid-cols-[280px_1fr] pb-12">
      <aside className="space-y-6 rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-glow">
        <div className="rounded-[28px] border border-white/10 bg-[#08101d] p-5">
          <div className="text-xs uppercase tracking-[0.3em] text-neutral-400">Nexora</div>
          <div className="mt-3 text-2xl font-semibold text-white">Command Center</div>
          <div className="mt-4 rounded-full border border-accent/20 bg-accent/10 px-3 py-2 text-xs uppercase tracking-[0.3em] text-accent">live sync</div>
        </div>

        <nav className="space-y-3">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setSelectedSection(section.id)}
              className={`block w-full rounded-[24px] border px-4 py-3 text-left text-sm transition ${
                selectedSection === section.id
                  ? 'border-accent bg-[#0f2b52] text-white shadow-[0_0_15px_rgba(77,159,255,0.18)]'
                  : 'border-white/10 bg-black/20 text-neutral-300 hover:border-accent/30 hover:bg-accent/5'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{section.label}</span>
                <span className={`h-2.5 w-2.5 rounded-full ${selectedSection === section.id ? 'bg-accent' : 'bg-white/10'}`} />
              </div>
            </a>
          ))}
        </nav>

        <div className="rounded-[28px] border border-white/10 bg-black/20 p-5 text-sm text-neutral-300">
          <div className="text-sm font-semibold text-white">Core objective</div>
          <p className="mt-3 leading-6 text-neutral-400">
            Launch Nexora OS as an enterprise brain that connects Slack, Jira, Gmail, Salesforce, Notion, and internal systems while keeping approvals safe.
          </p>
        </div>
      </aside>

      <main className="space-y-10">
        <section id="overview" className="glow-panel rounded-[32px] p-8">
          <div className="grid gap-8 xl:grid-cols-[1.55fr_0.85fr]">
            <div>
              <span className="badge badge-pill bg-white/5 text-white border-white/10">
                <span className="dot bg-accent2" /> System Overview
              </span>
              <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight neon-text">Nexora OS</h1>
              <p className="mt-4 text-base leading-7 text-neutral-300">
                A workplace intelligence brain that routes requests, retrieves graph-backed evidence, executes tools, and pauses for approval before high-impact actions.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
                  <div className="text-sm uppercase tracking-[0.3em] text-neutral-400">Live agents</div>
                  <div className="mt-3 text-2xl font-semibold text-white">4</div>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
                  <div className="text-sm uppercase tracking-[0.3em] text-neutral-400">Connected sources</div>
                  <div className="mt-3 text-2xl font-semibold text-white">6</div>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
                  <div className="text-sm uppercase tracking-[0.3em] text-neutral-400">Pending approvals</div>
                  <div className="mt-3 text-2xl font-semibold text-accent">{pending.length}</div>
                </div>
              </div>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#05101d] p-6 text-sm text-neutral-300 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-neutral-400">Workspace status</div>
                  <div className="mt-3 text-lg font-semibold text-white">Demo workspace live</div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-2 text-xs uppercase tracking-[0.3em] text-accent">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#64ffda] shadow-[0_0_10px_rgba(100,255,218,0.5)]" />
                  Live sync
                </div>
              </div>
              <div className="mt-4 text-sm text-neutral-400">Connected to the current organization context and tool integrations.</div>
              <div className="mt-6 space-y-3">
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="text-sm text-neutral-300">Agent core</div>
                  <div className="mt-2 text-white">Online</div>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="text-sm text-neutral-300">Vector store</div>
                  <div className="mt-2 text-white">Synced</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-[28px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Couldn&apos;t connect to the API. Confirm <code className="rounded px-1 py-0.5 bg-white/5">npm run dev -w apps/api</code> is running and the API URL is configured correctly.
            <div className="mt-2 text-xs text-neutral-400">{error}</div>
          </div>
        )}

        <section id="chat" className="min-h-[420px] rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-glow">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-neutral-400">Chat</div>
              <div className="mt-2 text-2xl font-semibold text-white">Command the agent</div>
            </div>
            <div className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent">Instant access</div>
          </div>
          <p className="mt-4 text-sm leading-6 text-neutral-300">
            Use Nexora OS as a single command center for enterprise intelligence. Ask questions, surface project status, and route decisions through safe approvals.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
              <div className="text-sm text-neutral-400">Last message</div>
              <div className="mt-3 text-white">“Show me the latest Jira ticket priority changes.”</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
              <div className="text-sm text-neutral-400">Response mode</div>
              <div className="mt-3 text-white">Hybrid retrieval + approvals</div>
            </div>
          </div>
        </section>

        <section id="approvals" className="min-h-[420px] rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-glow">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-neutral-400">Approvals</div>
              <div className="mt-2 text-2xl font-semibold text-white">Human-in-the-loop safety</div>
            </div>
            <div className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent">{pending.length} pending</div>
          </div>
          <p className="mt-4 text-sm leading-6 text-neutral-300">
            Pending approvals hold high-impact actions until a human confirms the intent and context. This keeps Nexora decisions safe and auditable.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
              <div className="text-sm text-neutral-400">Latest approval</div>
              <div className="mt-3 text-white">Update Jira issue priority from blocker to critical.</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
              <div className="text-sm text-neutral-400">Risk level</div>
              <div className="mt-3 text-white">Medium</div>
            </div>
          </div>
        </section>

        <section id="integrations" className="min-h-[420px] rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-glow">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-neutral-400">Integrations</div>
              <div className="mt-2 text-2xl font-semibold text-white">Connected tools</div>
            </div>
            <div className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent">{integrations.length} connected</div>
          </div>
          <p className="mt-4 text-sm leading-6 text-neutral-300">
            Monitor the systems Nexora is listening to and acting on in real time, including document, task, and communication sources.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {['Slack', 'Jira', 'Gmail', 'Salesforce', 'Notion', 'Internal DB'].map((tool) => (
              <div key={tool} className="rounded-[24px] border border-white/10 bg-black/20 p-5 text-sm text-neutral-300">
                <div className="font-semibold text-white">{tool}</div>
                <div className="mt-2 text-neutral-400">Active</div>
              </div>
            ))}
          </div>
        </section>

        <section id="roadmap" className="min-h-[420px] rounded-[32px] border border-white/10 bg-black/20 p-8 shadow-glow">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-neutral-400">Phased MVP implementation roadmap</div>
              <div className="mt-2 text-2xl font-semibold text-white">Nexora MVP roadmap</div>
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.keys(sprintPlans).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSelectedSprint(tab as keyof typeof sprintPlans)}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    selectedSprint === tab ? 'bg-accent text-[#04101f]' : 'bg-white/5 text-neutral-300 hover:bg-white/10'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-[28px] border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-sm uppercase tracking-[0.3em] text-accent">{selectedSprint}</div>
                <div className="mt-2 text-xl font-semibold text-white">{sprintPlans[selectedSprint].title}</div>
              </div>
              <div className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent">In progress</div>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-neutral-300">
              {sprintPlans[selectedSprint].items.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
