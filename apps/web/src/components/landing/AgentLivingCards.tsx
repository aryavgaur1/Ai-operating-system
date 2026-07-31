'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { BrandLogo } from '@/components/landing/BrandLogos';
import { cn } from '@/lib/utils';

export type AgentCardData = {
  name: string;
  tools: string[];
  status: 'Idle' | 'Active' | 'Running' | 'Configurable';
  caps: string[];
  memory: string;
  activity: string;
  memoryFill: number;
};

export const AGENT_CARDS: AgentCardData[] = [
  {
    name: 'Research Agent',
    tools: ['Notion', 'Drive', 'Slack'],
    status: 'Idle',
    caps: ['Web Search', 'Web Search + Docs', 'Web Search + Docs + Slack'],
    memory: 'Workspace + docs',
    activity: 'Indexed 12 sources',
    memoryFill: 72,
  },
  {
    name: 'Sales Agent',
    tools: ['Salesforce', 'Gmail', 'Slack'],
    status: 'Active',
    caps: ['CRM Sync', 'CRM Sync + Email', 'CRM Sync + Email + Slack'],
    memory: 'Pipeline context',
    activity: 'Drafted 3 replies',
    memoryFill: 84,
  },
  {
    name: 'Marketing Agent',
    tools: ['Notion', 'Slack', 'HubSpot'],
    status: 'Idle',
    caps: ['Campaign Brief', 'Campaign Brief + Assets', 'Campaign + Analytics'],
    memory: 'Brand + campaigns',
    activity: 'Queued content plan',
    memoryFill: 61,
  },
  {
    name: 'Support Agent',
    tools: ['Gmail', 'Slack', 'Linear'],
    status: 'Active',
    caps: ['Triage', 'Triage + Ticket', 'Triage + Ticket + Reply'],
    memory: 'Customer history',
    activity: 'Resolved 2 threads',
    memoryFill: 78,
  },
  {
    name: 'Operations Agent',
    tools: ['Jira', 'Slack', 'Notion'],
    status: 'Running',
    caps: ['Incident Sync', 'Incident + Status', 'Incident + Status + Docs'],
    memory: 'Runbooks',
    activity: 'Opened Jira EPIC-42',
    memoryFill: 91,
  },
  {
    name: 'Developer Agent',
    tools: ['GitHub', 'Jira', 'Slack'],
    status: 'Idle',
    caps: ['PR Summary', 'PR Summary + Notes', 'PR + Deploy Check'],
    memory: 'Repo + issues',
    activity: 'Summarized PR #118',
    memoryFill: 68,
  },
  {
    name: 'Finance Agent',
    tools: ['Sheets', 'Drive', 'Notion'],
    status: 'Idle',
    caps: ['Reports', 'Reports + Forecast', 'Reports + Forecast + P&L'],
    memory: 'Ledger context',
    activity: 'Built weekly P&L',
    memoryFill: 55,
  },
  {
    name: 'Custom Agents',
    tools: [],
    status: 'Configurable',
    caps: ['Blueprint', 'Blueprint + Nodes', 'Blueprint + Nodes + Tools'],
    memory: 'Shared OS memory',
    activity: 'Awaiting blueprint',
    memoryFill: 35,
  },
];

function AgentIcon({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-9 w-9 items-center justify-center">
      <motion.span
        className="absolute inset-[-2px] rounded-full bg-accent/25 blur-[6px]"
        animate={reduce ? undefined : { opacity: [0.2, 0.55, 0.2] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-full border border-accent/40 bg-[#0a1220]',
          active && 'shadow-[0_0_16px_rgba(91,157,255,0.5)] border-accent/70'
        )}
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
      >
        <span className="absolute h-1 w-1 rounded-full bg-accent2" style={{ top: 2, left: '50%', marginLeft: -2 }} />
        <span className="absolute h-1 w-1 rounded-full bg-accent/80" style={{ bottom: 3, right: 3 }} />
        <span className="absolute h-1 w-1 rounded-full bg-accent/60" style={{ bottom: 3, left: 3 }} />
        <span className="relative h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgba(91,157,255,0.8)]" />
      </motion.div>
    </div>
  );
}

function StatusBadge({ status, hover }: { status: AgentCardData['status']; hover: boolean }) {
  const map = {
    Active: { label: 'ACTIVE', color: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-emerald-400/25' },
    Running: { label: 'RUNNING', color: 'bg-accent2', text: 'text-accent2', border: 'border-accent2/25' },
    Idle: { label: 'IDLE', color: 'bg-neutral-400', text: 'text-neutral-400', border: 'border-white/10' },
    Configurable: { label: 'CONFIGURABLE', color: 'bg-accent', text: 'text-accent', border: 'border-accent/25' },
  }[status];

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide', map.border, map.text)}>
      <span className="relative flex h-1.5 w-1.5">
        {(status === 'Active' || status === 'Running' || hover) && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', map.color)} />
        )}
        <motion.span
          className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', map.color)}
          animate={status === 'Idle' ? { opacity: [0.35, 0.9, 0.35] } : undefined}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
      </span>
      {status === 'Running' ? '⚡ ' : ''}
      {map.label}
    </span>
  );
}

function CapsTypewriter({ phrases, hover }: { phrases: string[]; hover: boolean }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [text, setText] = useState(phrases[0] || '');

  useEffect(() => {
    if (reduce) {
      setText(phrases[0] || '');
      return;
    }
    const phrase = phrases[i % phrases.length] || '';
    let n = hover ? 0 : phrase.length;
    setText(hover ? '' : phrase);
    if (!hover) return;

    const typeId = window.setInterval(() => {
      n += 1;
      setText(phrase.slice(0, n));
      if (n >= phrase.length) window.clearInterval(typeId);
    }, 28);

    const nextId = window.setTimeout(() => setI((v) => v + 1), Math.max(1800, phrase.length * 28 + 900));
    return () => {
      window.clearInterval(typeId);
      window.clearTimeout(nextId);
    };
  }, [i, phrases, hover, reduce]);

  return (
    <p className="min-h-[1.25rem] text-sm text-neutral-300">
      {text}
      <motion.span
        className="ml-0.5 inline-block text-accent2"
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 0.9, repeat: Infinity }}
      >
        ▌
      </motion.span>
    </p>
  );
}

function ToolRow({ tools, hover }: { tools: string[]; hover: boolean }) {
  if (!tools.length) {
    return <p className="text-sm text-neutral-300">Your stack</p>;
  }
  return (
    <div className="flex items-center gap-2">
      {tools.map((t, idx) => (
        <div key={t} className="flex items-center gap-2">
          <motion.div
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 p-1"
            animate={hover ? { boxShadow: ['0 0 0 rgba(91,157,255,0)', '0 0 10px rgba(91,157,255,0.35)', '0 0 0 rgba(91,157,255,0)'] } : undefined}
            transition={{ duration: 1.6, repeat: Infinity, delay: idx * 0.25 }}
          >
            <BrandLogo name={t} className="h-full w-full" />
          </motion.div>
          {idx < tools.length - 1 && (
            <span className="relative h-px w-3 overflow-hidden bg-white/10">
              <motion.span
                className="absolute inset-y-0 w-2 bg-accent/80"
                animate={{ left: ['-100%', '120%'] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: idx * 0.2, ease: 'easeInOut' }}
              />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function MemoryBar({ fill, activity, memory, hover }: { fill: number; activity: string; memory: string; hover: boolean }) {
  const [val, setVal] = useState(fill);
  useEffect(() => {
    if (!hover) {
      setVal(fill);
      return;
    }
    const id = window.setInterval(() => {
      setVal((v) => Math.min(98, v + (Math.random() > 0.5 ? 1 : 0)));
    }, 400);
    return () => window.clearInterval(id);
  }, [hover, fill]);

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>Memory · {memory}</span>
        <span className="text-neutral-400">{val}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent2/80"
          animate={{ width: `${val}%` }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-400">{activity}</p>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentCardData }) {
  const [hover, setHover] = useState(false);
  const reduce = useReducedMotion();

  return (
    <motion.div
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'group relative overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.03] p-5 backdrop-blur-sm',
        'hover:border-accent/30 hover:shadow-[0_20px_50px_-28px_rgba(91,157,255,0.45)]'
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(91,157,255,0.1),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-30" />

      <div className="relative flex items-center justify-between">
        <AgentIcon active={hover || agent.status === 'Active' || agent.status === 'Running'} />
        <StatusBadge status={agent.status} hover={hover} />
      </div>

      <h3 className="font-display relative mt-4 text-lg text-white">{agent.name}</h3>

      <p className="relative mt-2 text-xs text-neutral-500">Capabilities</p>
      <div className="relative">
        <CapsTypewriter phrases={agent.caps} hover={hover || agent.status === 'Running'} />
      </div>

      <p className="relative mt-3 text-xs text-neutral-500">Connected tools</p>
      <div className="relative mt-1">
        <ToolRow tools={agent.tools} hover={hover || agent.status === 'Active' || agent.status === 'Running'} />
      </div>

      <div className="relative mt-4 overflow-hidden border-t border-white/5 pt-3">
        <motion.span
          className="pointer-events-none absolute left-0 top-0 h-px w-1/3 bg-gradient-to-r from-transparent via-accent/70 to-transparent"
          animate={{ left: ['-40%', '120%'] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.4 }}
        />
        <MemoryBar fill={agent.memoryFill} activity={agent.activity} memory={agent.memory} hover={hover} />
      </div>
    </motion.div>
  );
}

export function AgentLivingCards() {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {AGENT_CARDS.map((agent) => (
        <AgentCard key={agent.name} agent={agent} />
      ))}
    </div>
  );
}
