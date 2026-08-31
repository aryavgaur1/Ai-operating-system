/** Four featured agents for /ai-agents — live Nexora connectors only. */

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
    name: 'Workspace Operations',
    purpose: 'Coordinates launches, incidents, and cross-tool execution across your connected stack.',
    tools: ['Slack', 'Jira', 'Notion'],
    capabilities: ['Create war rooms', 'Open Jira issues', 'Publish Notion runbooks'],
    exampleWorkflow:
      '“Create a launch war room for Project Atlas” → Slack channel planned → approval → live channel with verified link.',
    status: 'Running',
  },
  {
    name: 'Gmail Intelligence',
    purpose: 'Reads and acts on real inbox data — search, open threads, and send with approval.',
    tools: ['Gmail'],
    capabilities: ['Search important mail', 'Open a thread', 'Send email (approved)'],
    exampleWorkflow:
      '“Find my important emails” → Gmail API search → summarized results from your actual inbox.',
    status: 'Active',
  },
  {
    name: 'Engineering Tracker',
    purpose: 'Keeps Jira work visible and actionable without leaving chat.',
    tools: ['Jira', 'Slack'],
    capabilities: ['Search open issues', 'Create tickets', 'Post updates to channels'],
    exampleWorkflow:
      '“Create a Jira ticket for the login bug” → issue draft with impact → Approve & run → NEX-123 with Jira URL.',
    status: 'Active',
  },
  {
    name: 'Documentation Curator',
    purpose: 'Finds and creates Notion knowledge from natural language.',
    tools: ['Notion', 'Slack'],
    capabilities: ['Search workspace docs', 'Create pages', 'Share links in Slack'],
    exampleWorkflow:
      '“Create a Notion page titled Weekly Launch Plan” → page preview → approval → live page URL returned.',
    status: 'Idle',
  },
];
