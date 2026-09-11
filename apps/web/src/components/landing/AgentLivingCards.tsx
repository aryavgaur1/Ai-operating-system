import { FEATURED_AGENTS } from '@/lib/featuredAgents';

export function AgentLivingCards() {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2">
      {FEATURED_AGENTS.map((agent) => (
        <article
          key={agent.name}
          className="rounded-2xl border border-white/10 bg-[#0b1220] p-6"
        >
          <h3 className="font-display text-lg text-white">{agent.name}</h3>
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
    </div>
  );
}
