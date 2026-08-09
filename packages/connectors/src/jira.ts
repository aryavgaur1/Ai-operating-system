import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';
import { getConnectorContext } from './context';

// ============================================================
// Jira Connector — live Atlassian Cloud REST API v3 via 3LO token.
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

function resolveJiraAuth(): { token: string; cloudId: string; siteUrl?: string } {
  const ctx = getConnectorContext();
  const token = ctx.jiraToken?.trim();
  const cloudId = ctx.jiraCloudId?.trim();
  if (token && cloudId) {
    return { token, cloudId, siteUrl: ctx.jiraSiteUrl };
  }
  if (ctx.saasStrict) {
    throw new Error('Jira is not connected for this workspace. Connect Jira under Integrations to continue.');
  }
  throw new Error('Jira is not connected. Open Integrations → Connect Jira, then try again.');
}

function apiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
}

async function jiraFetch(
  path: string,
  init: RequestInit & { token: string; cloudId: string }
): Promise<Response> {
  const { token, cloudId, ...rest } = init;
  return fetch(`${apiBase(cloudId)}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(rest.headers || {}),
    },
  });
}

async function resolveProjectKey(token: string, cloudId: string, preferred?: string): Promise<string> {
  const want = (preferred || process.env.JIRA_DEFAULT_PROJECT || '').trim().toUpperCase();
  const res = await jiraFetch('/project/search?maxResults=50', { method: 'GET', token, cloudId });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Could not list Jira projects (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { values?: Array<{ key: string; name?: string }> };
  const projects = data.values ?? [];
  if (!projects.length) {
    throw new Error('No Jira projects found on this site. Create a project in Jira, then retry.');
  }
  if (want) {
    const match = projects.find((p) => p.key.toUpperCase() === want);
    if (match) return match.key;
  }
  return projects[0].key;
}

function browseUrl(siteUrl: string | undefined, key: string): string {
  const base = (siteUrl || 'https://jira.atlassian.net').replace(/\/$/, '');
  return `${base}/browse/${key}`;
}

function toAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: text.slice(0, 8000) || ' ' }],
      },
    ],
  };
}

class JiraConnector implements ToolConnector {
  tool = 'jira' as const;

  async fetchRecent(_sinceCursor?: string): Promise<FetchPage> {
    if (isLiveMode('jira')) {
      const { token, cloudId, siteUrl } = resolveJiraAuth();
      const res = await jiraFetch('/search/jql', {
        method: 'POST',
        token,
        cloudId,
        body: JSON.stringify({
          jql: 'updated >= -7d ORDER BY updated DESC',
          maxResults: 25,
          fields: ['summary', 'status', 'assignee', 'priority', 'updated'],
        }),
      });
      if (!res.ok) {
        // Fallback older search endpoint
        const legacy = await jiraFetch(
          `/search?jql=${encodeURIComponent('updated >= -7d ORDER BY updated DESC')}&maxResults=25`,
          { method: 'GET', token, cloudId }
        );
        if (!legacy.ok) {
          const body = await legacy.text();
          throw new Error(`Jira search failed (${legacy.status}): ${body.slice(0, 200)}`);
        }
        const data = (await legacy.json()) as { issues?: any[] };
        return {
          items: (data.issues ?? []).map((issue) => ({
            externalId: issue.key,
            resourceType: 'issue' as const,
            title: `${issue.key}: ${issue.fields?.summary ?? 'Untitled'}`,
            url: browseUrl(siteUrl, issue.key),
            text: issue.fields?.summary ?? '',
            metadata: {
              status: issue.fields?.status?.name,
              assignee: issue.fields?.assignee?.displayName,
              priority: issue.fields?.priority?.name,
            },
          })),
        };
      }
      const data = (await res.json()) as { issues?: any[] };
      return {
        items: (data.issues ?? []).map((issue) => ({
          externalId: issue.key,
          resourceType: 'issue' as const,
          title: `${issue.key}: ${issue.fields?.summary ?? 'Untitled'}`,
          url: browseUrl(siteUrl, issue.key),
          text: issue.fields?.summary ?? '',
          metadata: {
            status: issue.fields?.status?.name,
            assignee: issue.fields?.assignee?.displayName,
            priority: issue.fields?.priority?.name,
          },
        })),
      };
    }
    await simulateLatency();
    return { items: MOCK_ISSUES, nextCursor: undefined };
  }

  async handleWebhook(payload: unknown): Promise<NormalizedDoc[]> {
    await simulateLatency(20, 60);
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
    return ['createIssue', 'transitionIssue', 'deleteIssue', 'addComment', 'searchIssues'];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    if (isLiveMode('jira')) {
      try {
        const { token, cloudId, siteUrl } = resolveJiraAuth();
        switch (action) {
          case 'createIssue': {
            const summary = String(input.summary ?? input.title ?? 'Untitled issue').slice(0, 255);
            const description = String(input.description ?? input.body ?? summary);
            const projectKey = await resolveProjectKey(
              token,
              cloudId,
              String(input.project ?? input.projectKey ?? '')
            );
            const issueType = String(input.issueType ?? input.type ?? 'Task');
            const res = await jiraFetch('/issue', {
              method: 'POST',
              token,
              cloudId,
              body: JSON.stringify({
                fields: {
                  project: { key: projectKey },
                  summary,
                  description: toAdf(description),
                  issuetype: { name: issueType },
                },
              }),
            });
            if (!res.ok) {
              const body = await res.text();
              // Retry with Bug if Task name invalid
              if (/issuetype|issue type/i.test(body)) {
                const retry = await jiraFetch('/issue', {
                  method: 'POST',
                  token,
                  cloudId,
                  body: JSON.stringify({
                    fields: {
                      project: { key: projectKey },
                      summary,
                      description: toAdf(description),
                      issuetype: { name: 'Bug' },
                    },
                  }),
                });
                if (!retry.ok) {
                  const retryBody = await retry.text();
                  return {
                    tool: 'jira',
                    action,
                    ok: false,
                    error: `Jira createIssue failed (${retry.status}): ${retryBody.slice(0, 300)}`,
                    mocked: false,
                  };
                }
                const created = (await retry.json()) as { id: string; key: string };
                console.log(`[jira.createIssue] REAL ok key=${created.key}`);
                return {
                  tool: 'jira',
                  action,
                  ok: true,
                  output: {
                    id: created.id,
                    key: created.key,
                    url: browseUrl(siteUrl, created.key),
                    project: projectKey,
                  },
                  mocked: false,
                };
              }
              return {
                tool: 'jira',
                action,
                ok: false,
                error: `Jira createIssue failed (${res.status}): ${body.slice(0, 300)}`,
                mocked: false,
              };
            }
            const created = (await res.json()) as { id: string; key: string };
            console.log(`[jira.createIssue] REAL ok key=${created.key}`);
            return {
              tool: 'jira',
              action,
              ok: true,
              output: {
                id: created.id,
                key: created.key,
                url: browseUrl(siteUrl, created.key),
                project: projectKey,
              },
              mocked: false,
            };
          }

          case 'addComment': {
            const key = String(input.key ?? input.issueKey ?? '').trim();
            const body = String(input.body ?? input.comment ?? '').trim();
            if (!key || !body) {
              return { tool: 'jira', action, ok: false, error: 'key and body are required', mocked: false };
            }
            const res = await jiraFetch(`/issue/${encodeURIComponent(key)}/comment`, {
              method: 'POST',
              token,
              cloudId,
              body: JSON.stringify({ body: toAdf(body) }),
            });
            if (!res.ok) {
              const text = await res.text();
              return {
                tool: 'jira',
                action,
                ok: false,
                error: `Jira addComment failed (${res.status}): ${text.slice(0, 300)}`,
                mocked: false,
              };
            }
            return {
              tool: 'jira',
              action,
              ok: true,
              output: { key, applied: true, url: browseUrl(siteUrl, key) },
              mocked: false,
            };
          }

          case 'transitionIssue': {
            const key = String(input.key ?? input.issueKey ?? '').trim();
            const target = String(input.status ?? input.transition ?? input.to ?? '').trim();
            if (!key) {
              return { tool: 'jira', action, ok: false, error: 'issue key is required', mocked: false };
            }
            const listRes = await jiraFetch(`/issue/${encodeURIComponent(key)}/transitions`, {
              method: 'GET',
              token,
              cloudId,
            });
            if (!listRes.ok) {
              const text = await listRes.text();
              return {
                tool: 'jira',
                action,
                ok: false,
                error: `Could not load transitions (${listRes.status}): ${text.slice(0, 200)}`,
                mocked: false,
              };
            }
            const list = (await listRes.json()) as {
              transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
            };
            const transitions = list.transitions ?? [];
            const match =
              transitions.find(
                (t) =>
                  t.name.toLowerCase() === target.toLowerCase() ||
                  t.to?.name?.toLowerCase() === target.toLowerCase()
              ) || transitions[0];
            if (!match) {
              return { tool: 'jira', action, ok: false, error: `No transitions available for ${key}`, mocked: false };
            }
            const res = await jiraFetch(`/issue/${encodeURIComponent(key)}/transitions`, {
              method: 'POST',
              token,
              cloudId,
              body: JSON.stringify({ transition: { id: match.id } }),
            });
            if (!res.ok) {
              const text = await res.text();
              return {
                tool: 'jira',
                action,
                ok: false,
                error: `Jira transition failed (${res.status}): ${text.slice(0, 300)}`,
                mocked: false,
              };
            }
            return {
              tool: 'jira',
              action,
              ok: true,
              output: { key, transition: match.name, applied: true, url: browseUrl(siteUrl, key) },
              mocked: false,
            };
          }

          case 'deleteIssue': {
            const key = String(input.key ?? input.issueKey ?? '').trim();
            if (!key) {
              return { tool: 'jira', action, ok: false, error: 'issue key is required', mocked: false };
            }
            const res = await jiraFetch(`/issue/${encodeURIComponent(key)}`, {
              method: 'DELETE',
              token,
              cloudId,
            });
            if (!res.ok && res.status !== 204) {
              const text = await res.text();
              return {
                tool: 'jira',
                action,
                ok: false,
                error: `Jira deleteIssue failed (${res.status}): ${text.slice(0, 300)}`,
                mocked: false,
              };
            }
            return { tool: 'jira', action, ok: true, output: { key, deleted: true }, mocked: false };
          }

          case 'searchIssues': {
            const q = String(input.query ?? input.jql ?? input.summary ?? '').trim();
            const jql = q.includes('=') || /\bORDER BY\b/i.test(q) ? q : `text ~ "${q.replace(/"/g, '\\"')}" ORDER BY updated DESC`;
            const res = await jiraFetch(
              `/search?jql=${encodeURIComponent(jql)}&maxResults=${Number(input.limit ?? 10)}`,
              { method: 'GET', token, cloudId }
            );
            if (!res.ok) {
              const text = await res.text();
              return {
                tool: 'jira',
                action,
                ok: false,
                error: `Jira search failed (${res.status}): ${text.slice(0, 300)}`,
                mocked: false,
              };
            }
            const data = (await res.json()) as { issues?: any[] };
            const results = (data.issues ?? []).map((issue) => ({
              key: issue.key,
              summary: issue.fields?.summary,
              status: issue.fields?.status?.name,
              url: browseUrl(siteUrl, issue.key),
            }));
            return { tool: 'jira', action, ok: true, output: { results, count: results.length }, mocked: false };
          }

          default:
            return { tool: 'jira', action, ok: false, error: `Unknown action: ${action}`, mocked: false };
        }
      } catch (err: any) {
        return { tool: 'jira', action, ok: false, error: err?.message ?? String(err), mocked: false };
      }
    }

    await simulateLatency();
    console.warn(`[MOCK jira.${action}] JIRA_MODE is not live`);
    switch (action) {
      case 'createIssue':
        return {
          tool: 'jira',
          action,
          ok: false,
          error: 'Jira is in MOCK mode. Connect Jira (OAuth) and set JIRA_MODE=live.',
          mocked: true,
        };
      default:
        return {
          tool: 'jira',
          action,
          ok: false,
          error: 'Jira is in MOCK mode. Connect Jira under Integrations.',
          mocked: true,
        };
    }
  }
}

export const jiraConnector = new JiraConnector();
