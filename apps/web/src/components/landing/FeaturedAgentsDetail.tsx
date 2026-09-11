import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FEATURED_AGENTS } from '@/lib/featuredAgents';
import { REGISTER } from '@/lib/routes';

export function FeaturedAgentsDetail() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FEATURED_AGENTS.map((agent) => (
        <article
          key={agent.name}
          className="rounded-2xl border border-white/10 bg-[#0b1220] p-6"
        >
          <h2 className="font-display text-xl font-semibold text-white">{agent.name}</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-400">{agent.purpose}</p>
          <ul className="mt-4 space-y-1.5 text-sm text-neutral-300">
            {agent.capabilities.map((cap) => (
              <li key={cap} className="flex items-start gap-2">
                <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-accent" />
                {cap}
              </li>
            ))}
          </ul>
        </article>
      ))}
      <div className="sm:col-span-2 mt-2 flex flex-wrap gap-3">
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
