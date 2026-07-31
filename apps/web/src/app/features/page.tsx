import type { Metadata } from 'next';
import { MarketingShell } from '@/components/landing/MarketingShell';

export const metadata: Metadata = {
  title: 'Features — Nexora OS',
  description: 'AI agents, memory, reasoning, automation, and enterprise security in one operating system.',
};

const FEATURES = [
  ['AI Agents', 'Specialists for research, sales, support, ops, and more — sharing one OS memory.'],
  ['Memory', 'Workspace, conversation, document, and decision history that compounds.'],
  ['Automation', 'Turn recurring coordination into reliable, approvable workflows.'],
  ['Reasoning Engine', 'Plans multi-step work before calling tools.'],
  ['Knowledge Graph', 'Retrieve evidence across docs, chat, and systems.'],
  ['Cross-Platform Execution', 'One command spans Slack, Notion, and your stack.'],
  ['Enterprise Security', 'Encryption, RBAC, audit trails, workspace isolation.'],
  ['Approvals', 'Human-in-the-loop for high-impact actions.'],
  ['Integrations', 'Live connectors with health, sync, and capabilities.'],
];

export default function FeaturesPage() {
  return (
    <MarketingShell
      title="Features"
      subtitle="An AI Operating System — not another chatbot. Connect tools, reason over context, and execute real work."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([t, b]) => (
          <div key={t} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
            <h2 className="font-display text-lg text-white">{t}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-400">{b}</p>
          </div>
        ))}
      </div>
    </MarketingShell>
  );
}
