import type { IntegrationStatus } from '@/lib/api';

export type ConnectionTool = 'slack' | 'gmail' | 'notion' | 'jira';

export type ConnectionDisplayStatus = 'connected' | 'not_connected' | 'needs_attention' | 'unavailable';

export type ConnectionDefinition = {
  tool: ConnectionTool;
  name: string;
  description: string;
  scopeLabel: string;
};

export const CONNECTION_TOOLS: ConnectionDefinition[] = [
  {
    tool: 'slack',
    name: 'Slack',
    description: 'Search channels, post updates, and run approved Slack actions from Command.',
    scopeLabel: 'Your Slack workspace',
  },
  {
    tool: 'gmail',
    name: 'Gmail',
    description: 'Search and read email via Gmail API. Sending requires approval.',
    scopeLabel: 'Your Google account',
  },
  {
    tool: 'notion',
    name: 'Notion',
    description: 'Create and update Notion pages after you share them with the integration.',
    scopeLabel: 'Your Notion workspace',
  },
  {
    tool: 'jira',
    name: 'Jira',
    description: 'Create and update Jira issues on your connected Atlassian site.',
    scopeLabel: 'Your Jira Cloud site',
  },
];

/** Human labels for connector actions — keyed by tool:action when names collide. */
const ACTION_LABELS: Record<string, string> = {
  // Slack
  'slack:searchMessages': 'Search messages',
  'slack:searchHistory': 'Search channel history',
  'slack:semanticSearch': 'Semantic search across Slack',
  'slack:postMessage': 'Post messages',
  'slack:postMessageExternalChannel': 'Post to channels',
  'slack:createChannel': 'Create channels',
  'slack:createWarRoom': 'Create launch war rooms',
  'slack:createIncident': 'Create incident channels',
  'slack:listChannels': 'List channels',
  'slack:getChannelHistory': 'Read channel history',
  'slack:getThread': 'Read Slack threads',
  'slack:inviteUsers': 'Invite members to channels',
  'slack:setChannelTopic': 'Set channel topic',
  'slack:summarizeChannel': 'Summarize channels',
  'slack:findBlockers': 'Detect blockers',
  'slack:dailyDigest': 'Daily digest',
  // Gmail (API only — no SMTP)
  'gmail:searchEmails': 'Search email',
  'gmail:getEmail': 'Read an email',
  'gmail:getThread': 'Read email threads',
  'gmail:sendEmail': 'Send email (approval required)',
  // Notion
  'notion:createPage': 'Create pages',
  'notion:updatePage': 'Update pages',
  'notion:searchPages': 'Search pages',
  'notion:searchDatabases': 'Search databases',
  'notion:createProject': 'Create project hubs',
  'notion:createMeetingNotes': 'Create meeting notes',
  'notion:createPRD': 'Create PRD pages',
  'notion:createWiki': 'Create wiki pages',
  'notion:createRoadmap': 'Create roadmaps',
  'notion:publishPage': 'Publish pages',
  'notion:deletePage': 'Delete pages',
  'notion:createDatabaseEntry': 'Create database entries',
  'notion:createDatabase': 'Create databases',
  // Jira
  'jira:createIssue': 'Create issues',
  'jira:updateIssue': 'Update issues',
  'jira:transitionIssue': 'Transition issue status',
  'jira:addComment': 'Add comments',
  'jira:searchIssues': 'Search issues',
  'jira:listBoards': 'List boards',
  'jira:listSprints': 'List sprints',
  'jira:getSprintIssues': 'Read sprint issues',
  'jira:linkIssues': 'Link issues',
  'jira:addAttachment': 'Add attachments',
  'jira:deleteIssue': 'Delete issues',
};

/** Curated highlights shown first; remaining actions listed after. */
const HIGHLIGHT_ACTIONS: Record<ConnectionTool, string[]> = {
  slack: ['searchMessages', 'semanticSearch', 'postMessage', 'createWarRoom', 'createChannel'],
  gmail: ['searchEmails', 'getEmail', 'getThread', 'sendEmail'],
  notion: ['searchPages', 'createPage', 'updatePage', 'createProject'],
  jira: ['searchIssues', 'createIssue', 'updateIssue', 'addComment'],
};

export function resolveConnectionStatus(row?: IntegrationStatus): ConnectionDisplayStatus {
  if (!row || row.status === 'not_implemented' || row.implementation === 'not_implemented') {
    return 'unavailable';
  }
  if (row.status === 'active') {
    if (row.tool === 'slack' && row.botToken && row.userToken === false) {
      return 'needs_attention';
    }
    return 'connected';
  }
  if (row.canConnect && row.mode === 'live') return 'not_connected';
  return 'not_connected';
}

export function statusLabel(status: ConnectionDisplayStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'not_connected':
      return 'Not connected';
    case 'needs_attention':
      return 'Needs attention';
    default:
      return 'Unavailable';
  }
}

export function formatCapabilities(tool: ConnectionTool, availableActions: string[] = []): string[] {
  const actions = new Set(availableActions);
  const highlights = HIGHLIGHT_ACTIONS[tool].filter((a) => actions.has(a));
  const labels = new Set<string>();
  const labelFor = (action: string) => ACTION_LABELS[`${tool}:${action}`] || action;
  for (const action of highlights) {
    labels.add(labelFor(action));
  }
  for (const action of availableActions) {
    if (HIGHLIGHT_ACTIONS[tool].includes(action)) continue;
    labels.add(labelFor(action));
  }
  const list = [...labels];
  if (list.length && tool !== 'gmail') {
    list.push('Execute approved write actions');
  }
  if (tool === 'gmail' && actions.has('sendEmail')) {
    if (!list.some((l) => l.includes('Send email'))) {
      list.push('Send email (approval required)');
    }
  }
  return list;
}

export function formatScope(row: IntegrationStatus | undefined, fallback: string): string {
  if (row?.status === 'active' && row.workspaceName) return row.workspaceName;
  return fallback;
}

export function formatLastUsed(row?: IntegrationStatus): string {
  const iso = row?.lastUsedAt || row?.lastSync;
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export function formatConnectedSince(row?: IntegrationStatus): string {
  if (!row?.connectedAt) return '—';
  try {
    return new Date(row.connectedAt).toLocaleDateString();
  } catch {
    return '—';
  }
}
