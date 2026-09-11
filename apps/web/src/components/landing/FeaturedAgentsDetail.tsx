'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FEATURED_AGENTS } from '@/lib/featuredAgents';
import { REGISTER } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function FeaturedAgentsDetail() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {FEATURED_AGENTS.map((agent) => (
        <article
          key={agent.name}
          className="rounded-[28px] border border-white/8 bg-white/[0.03] p-6 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-white">{agent.name}</h2>
            <span
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wide',
                agent.status === 'Running'
                  ? 'border-accent2/30 text-accent2'
                  : agent.status === 'Active'
                    ? 'border-emerald-400/30 text-emerald-300'
                    : 'border-white/10 text-neutral-400'
              )}
            >
              {agent.status}
            </span>
          </div>
          <p className="mt-3 text-sm leading-7 text-neutral-400">{agent.purpose}</p>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">Integrations</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {agent.tools.map((tool) => (
                <span key={tool} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-200">
                  {tool}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">What it can do</div>
            <ul className="mt-2 space-y-1.5 text-sm text-neutral-300">
              {agent.capabilities.map((cap) => (
                <li key={cap} className="flex items-start gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                  {cap}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 rounded-2xl border border-white/8 bg-black/25 p-4 text-sm leading-7 text-neutral-400">
            <span className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Example workflow</span>
            <p className="mt-2 text-neutral-300">{agent.exampleWorkflow}</p>
          </div>
        </article>
      ))}
      <div className="lg:col-span-2 mt-2 flex flex-wrap gap-3">
        <Link href={REGISTER} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]">
          Open workspace <ArrowRight size={14} />
        </Link>
        <Link href="/how-it-works" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm text-white">
          How approvals work
        </Link>
      </div>
    </div>
  );
}
