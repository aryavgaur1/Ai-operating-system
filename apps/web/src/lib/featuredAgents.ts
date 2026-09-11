/** Four agents shown on the homepage and /ai-agents. */

export type FeaturedAgent = {
  name: string;
  purpose: string;
  capabilities: string[];
};

export const FEATURED_AGENTS: FeaturedAgent[] = [
  {
    name: 'Research',
    purpose: 'Finds answers in your docs and the web, then cites what it used.',
    capabilities: ['Search connected docs', 'Summarize sources', 'Share a brief in Slack'],
  },
  {
    name: 'Support',
    purpose: 'Helps you triage inbound questions and draft replies from real context.',
    capabilities: ['Sort new tickets', 'Draft a reply', 'Pull recent customer history'],
  },
  {
    name: 'Operations',
    purpose: 'Keeps incidents, tickets, and runbooks moving across the tools you already use.',
    capabilities: ['Open or update a ticket', 'Post a status update', 'Find the right runbook'],
  },
  {
    name: 'Developer',
    purpose: 'Catches you up on code review, issues, and repo changes without extra dashboards.',
    capabilities: ['Summarize a pull request', 'List open issues', 'Draft a changelog note'],
  },
];
