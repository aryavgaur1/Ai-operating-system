/** Four featured agents for /ai-agents — Research, Support, Operations, Developer. */

export type FeaturedAgent = {
  name: string;
  purpose: string;
  tools: string[];
  capabilities: string[];
  exampleWorkflow: string;
  status: 'Active' | 'Running' | 'Idle';
};

export const FEATURED_AGENTS: FeaturedAgent[] = [
  {
    name: 'Research',
    purpose: 'Finds answers in your docs and the web, then cites what it used.',
    tools: ['Notion', 'Drive', 'Slack'],
    capabilities: ['Search connected docs', 'Summarize sources', 'Share a brief in Slack'],
    exampleWorkflow:
      '“Summarize the launch brief” → search connected docs → cited summary → optional Slack share after approval.',
    status: 'Idle',
  },
  {
    name: 'Support',
    purpose: 'Helps you triage inbound questions and draft replies from real context.',
    tools: ['Gmail', 'Slack', 'Linear'],
    capabilities: ['Sort new tickets', 'Draft a reply', 'Pull recent customer history'],
    exampleWorkflow:
      '“Triage today’s support inbox” → ranked threads → draft reply from history → send only after Approve & run.',
    status: 'Active',
  },
  {
    name: 'Operations',
    purpose: 'Keeps incidents, tickets, and runbooks moving across the tools you already use.',
    tools: ['Jira', 'Slack', 'Notion'],
    capabilities: ['Open or update a ticket', 'Post a status update', 'Find the right runbook'],
    exampleWorkflow:
      '“Open an incident war room” → Slack channel + Jira issue planned → approval → live links returned.',
    status: 'Running',
  },
  {
    name: 'Developer',
    purpose: 'Catches you up on code review, issues, and repo changes without extra dashboards.',
    tools: ['GitHub', 'Jira', 'Slack'],
    capabilities: ['Summarize a pull request', 'List open issues', 'Draft a changelog note'],
    exampleWorkflow:
      '“Summarize PR #118” → review notes from the repo → optional Jira/Slack update after approval.',
    status: 'Idle',
  },
];
