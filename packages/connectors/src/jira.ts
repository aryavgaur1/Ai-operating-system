import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';

// ============================================================
// Jira Connector
// Live wiring point: jira.js or a raw fetch against the Jira
// Cloud REST API (v3), using the org's OAuth 2.0 (3LO) token.
// Webhooks: Jira "Issue Updated" / "Issue Created" webhooks.
// ============================================================

const MOCK_ISSUES: NormalizedDoc[] = [
  {
    externalId: 'PHX-142',
    resourceType: 'issue',
    title: 'PHX-142: Vendor API contract blocking integration',
    url: 'https://mock-org.atlassian.net/browse/PHX-142',
    text: 'Blocked — waiting on signed vendor contract before integration work can resume. Assignee: Arjun.',
    metadata: { project: 'PHX', status: 'Blocked', assignee: 'arjun', priority: 'High' },
  },
  {
    externalId: 'PHX-150',
    resourceType: 'issue',
    title: 'PHX-150: Dashboard rollout for Acme Corp',
    url: 'https://mock-org.atlassian.net/browse/PHX-150',
    text: 'In progress — dashboard rollout for Acme Corp, targeting release next sprint. Assignee: Meera.',
    metadata: { project: 'PHX', status: 'In Progress', assignee: 'meera', priority: 'Medium', client: 'Acme Corp' },
  },
];

class JiraConnector implements ToolConnector {
  tool = 'jira' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): GET /rest/api/3/search?jql=updated>={sinceCursor} order by updated asc
      throw new Error('Jira live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
    return { items: MOCK_ISSUES, nextCursor: undefined };
  }

  async handleWebhook(payload: unknown): Promise<NormalizedDoc[]> {
    await simulateLatency(20, 60);
    // TODO(live): verify webhook, parse `issue_updated` / `issue_created` events
    const p = payload as { key?: string; fields?: { summary?: string; status?: { name?: string } } };
    if (!p?.key) return [];
    return [
      {
        externalId: p.key,
        resourceType: 'issue',
        title: `${p.key}: ${p.fields?.summary ?? 'Untitled issue'}`,
        url: `https://mock-org.atlassian.net/browse/${p.key}`,
        text: p.fields?.summary ?? '',
        metadata: { status: p.fields?.status?.name },
      },
    ];
  }

  listActions(): string[] {
    return ['createIssue', 'transitionIssue', 'deleteIssue', 'addComment'];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): POST/PUT/DELETE against /rest/api/3/issue endpoints
      throw new Error('Jira live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
    console.log(`[MOCK jira.${action}]`, input);
    switch (action) {
      case 'createIssue':
        return {
          tool: 'jira',
          action,
          ok: true,
          output: { key: `PHX-${100 + Math.floor(Math.random() * 900)}`, ...input },
          mocked: true,
        };
      case 'transitionIssue':
      case 'deleteIssue':
      case 'addComment':
        return { tool: 'jira', action, ok: true, output: { ...input, applied: true }, mocked: true };
      default:
        return { tool: 'jira', action, ok: false, error: `Unknown action: ${action}`, mocked: true };
    }
  }
}

export const jiraConnector = new JiraConnector();
