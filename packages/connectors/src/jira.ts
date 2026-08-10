import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';
import { getConnectorContext } from './context';

// ============================================================
// Jira Connector — live Atlassian Cloud REST API v3 (+ Agile 1.0)
// Advanced: assign/priority/due/labels/components/custom fields,
// link issues, attachments, boards/sprints, webhook normalize.
// ============================================================

const MOCK_ISSUES: NormalizedDoc[] = [
  {
    externalId: 'PHX-142',
    resourceType: 'issue',
    title: 'PHX-142: Vendor API contract blocking integration',
    url: 'https://mock-org.atlassian.net/browse/PHX-142',
    text: 'Blocked — waiting on signed vendor contract.',
    metadata: { project: 'PHX', status: 'Blocked', assignee: 'arjun', priority: 'High' },
  },
  {
    externalId: 'PHX-150',
    resourceType: 'issue',
    title: 'PHX-150: Dashboard rollout for Acme Corp',
    url: 'https://mock-org.atlassian.net/browse/PHX-150',
    text: 'In progress — dashboard rollout for Acme Corp.',
    metadata: { project: 'PHX', status: 'In Progress', assignee: 'meera', priority: 'Medium' },
  },
];

function resolveJiraAuth(): { token: string; cloudId: string; siteUrl?: string } {
  const ctx = getConnectorContext();
  const token = ctx.jiraToken?.trim();
  const cloudId = ctx.jiraCloudId?.trim();
  if (token && cloudId) return { token, cloudId, siteUrl: ctx.jiraSiteUrl };
  if (ctx.saasStrict) {
    throw new Error('Jira is not connected for this workspace. Connect Jira under Integrations to continue.');
  }
  throw new Error('Jira is not connected. Open Integrations → Connect Jira, then try again.');
}

function apiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
}

function agileBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0`;
}

async function jiraFetch(
  path: string,
  init: RequestInit & { token: string; cloudId: string; agile?: boolean }
): Promise<Response> {
  const { token, cloudId, agile, ...rest } = init;
  const base = agile ? agileBase(cloudId) : apiBase(cloudId);
  return fetch(`${base}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
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
  const data = (await res.json()) as { values?: Array<{ key: string }> };
  const projects = data.values ?? [];
  if (!projects.length) throw new Error('No Jira projects found on this site.');
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
    content: [{ type: 'paragraph', content: [{ type: 'text', text: text.slice(0, 8000) || ' ' }] }],
  };
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function buildIssueFields(
  input: Record<string, unknown>,
  opts?: { includeProjectType?: { projectKey: string; issueType: string } }
) {
  const fields: Record<string, unknown> = {};
  if (opts?.includeProjectType) {
    fields.project = { key: opts.includeProjectType.projectKey };
    fields.issuetype = { name: opts.includeProjectType.issueType };
  }
  if (input.summary != null || input.title != null) {
    fields.summary = String(input.summary ?? input.title).slice(0, 255);
  }
  if (input.description != null || input.body != null) {
    fields.description = toAdf(String(input.description ?? input.body));
  }
  if (input.priority ?? input.priorityName) {
    fields.priority = { name: String(input.priority ?? input.priorityName) };
  }
  const assignee = input.assignee ?? input.assigneeAccountId ?? input.assigneeId;
  if (assignee) {
    const a = String(assignee).trim();
    fields.assignee = a.includes('@') ? { emailAddress: a } : { accountId: a };
  }
  const due = input.dueDate ?? input.duedate ?? input.due;
  if (due) fields.duedate = String(due).slice(0, 10);
  const labels = asStringList(input.labels ?? input.label);
  if (labels.length) fields.labels = labels;
  const components = asStringList(input.components ?? input.component);
  if (components.length) fields.components = components.map((name) => ({ name }));

  const custom = (input.customFields ?? input.custom) as Record<string, unknown> | undefined;
  if (custom && typeof custom === 'object') {
    for (const [k, v] of Object.entries(custom)) {
      if (k.startsWith('customfield_')) fields[k] = v;
    }
  }
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith('customfield_')) fields[k] = v;
  }

  const sevField = process.env.JIRA_CUSTOM_SEV_FIELD?.trim();
  const envField = process.env.JIRA_CUSTOM_ENV_FIELD?.trim();
  const riskField = process.env.JIRA_CUSTOM_DEPLOY_RISK_FIELD?.trim();
  if (sevField && input.sev != null) fields[sevField] = input.sev;
  if (envField && (input.environment ?? input.env) != null) fields[envField] = input.environment ?? input.env;
  if (riskField && (input.deploymentRisk ?? input.deployRisk) != null) {
    fields[riskField] = input.deploymentRisk ?? input.deployRisk;
  }
  return fields;
}

async function verifyIssue(token: string, cloudId: string, key: string) {
  const res = await jiraFetch(
    `/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,priority,duedate,labels,components`,
    { method: 'GET', token, cloudId }
  );
  if (!res.ok) return { ok: false as const };
  const body = (await res.json()) as { key?: string; fields?: any };
  return { ok: Boolean(body.key === key), status: body.fields?.status?.name as string | undefined, fields: body.fields };
}

function mockOff(action: string): ToolCallResult {
  return {
    tool: 'jira',
    action,
    ok: false,
    error: 'Jira is in MOCK mode. Connect Jira under Integrations and set JIRA_MODE=live.',
    mocked: true,
  };
}

class JiraConnector implements ToolConnector {
  tool = 'jira' as const;

  async fetchRecent(_sinceCursor?: string): Promise<FetchPage> {
    if (!isLiveMode('jira')) {
      await simulateLatency();
      return { items: MOCK_ISSUES };
    }
    const { token, cloudId, siteUrl } = resolveJiraAuth();
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

  async handleWebhook(payload: unknown): Promise<NormalizedDoc[]> {
    const p = payload as {
      webhookEvent?: string;
      issue?: { key?: string; fields?: { summary?: string; status?: { name?: string } } };
      changelog?: { items?: Array<{ field?: string; fromString?: string; toString?: string }> };
      key?: string;
      fields?: { summary?: string; status?: { name?: string } };
    };
    const key = p.issue?.key || p.key;
    if (!key) return [];
    const statusChange = (p.changelog?.items || []).find((i) => i.field === 'status');
    const summary = p.issue?.fields?.summary || p.fields?.summary || 'Untitled issue';
    const status = p.issue?.fields?.status?.name || p.fields?.status?.name || statusChange?.toString;
    return [
      {
        externalId: key,
        resourceType: 'issue',
        title: `${key}: ${summary}`,
        url: browseUrl(undefined, key),
        text: statusChange
          ? `Status changed ${statusChange.fromString ?? '?'} → ${statusChange.toString ?? '?'}`
          : summary,
        metadata: {
          status,
          webhookEvent: p.webhookEvent,
          statusFrom: statusChange?.fromString,
          statusTo: statusChange?.toString,
          notifySlack: Boolean(statusChange),
        },
      },
    ];
  }

  listActions(): string[] {
    return [
      'createIssue',
      'updateIssue',
      'transitionIssue',
      'addComment',
      'linkIssues',
      'addAttachment',
      'searchIssues',
      'listBoards',
      'listSprints',
      'getSprintIssues',
      'deleteIssue',
    ];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    if (!isLiveMode('jira')) {
      await simulateLatency();
      return mockOff(action);
    }

    try {
      const { token, cloudId, siteUrl } = resolveJiraAuth();

      switch (action) {
        case 'createIssue': {
          const summary = String(input.summary ?? input.title ?? 'Untitled issue').slice(0, 255);
          const projectKey = await resolveProjectKey(token, cloudId, String(input.project ?? input.projectKey ?? ''));
          const preferredType = String(input.issueType ?? input.type ?? 'Task');
          const typeCandidates = Array.from(new Set([preferredType, 'Task', 'Bug', 'Story', 'Risk'].filter(Boolean)));
          let created: { id: string; key: string } | null = null;
          let lastError = '';
          let usedType = preferredType;
          for (const issueType of typeCandidates) {
            const fields = buildIssueFields(
              { ...input, summary, description: input.description ?? input.body ?? summary },
              { includeProjectType: { projectKey, issueType } }
            );
            const res = await jiraFetch('/issue', {
              method: 'POST',
              token,
              cloudId,
              body: JSON.stringify({ fields }),
            });
            if (res.ok) {
              created = (await res.json()) as { id: string; key: string };
              usedType = issueType;
              break;
            }
            lastError = await res.text();
            if (!/issuetype|issue type/i.test(lastError)) {
              return {
                tool: 'jira',
                action,
                ok: false,
                error: `Jira createIssue failed (${res.status}): ${lastError.slice(0, 300)}`,
                mocked: false,
              };
            }
          }
          if (!created) {
            return { tool: 'jira', action, ok: false, error: `Jira createIssue failed: ${lastError.slice(0, 300)}`, mocked: false };
          }
          const verified = await verifyIssue(token, cloudId, created.key);
          if (!verified.ok) {
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `Jira created ${created.key} but verification fetch failed.`,
              mocked: false,
            };
          }
          console.log(`[jira.createIssue] REAL ok key=${created.key} type=${usedType}`);
          return {
            tool: 'jira',
            action,
            ok: true,
            output: {
              id: created.id,
              key: created.key,
              url: browseUrl(siteUrl, created.key),
              project: projectKey,
              issueType: usedType,
              status: verified.status,
              verified: true,
            },
            mocked: false,
          };
        }

        case 'updateIssue': {
          const key = String(input.key ?? input.issueKey ?? '').trim();
          if (!key) return { tool: 'jira', action, ok: false, error: 'issue key is required', mocked: false };
          const fields = buildIssueFields(input);
          if (!Object.keys(fields).length) {
            return { tool: 'jira', action, ok: false, error: 'No update fields provided', mocked: false };
          }
          const res = await jiraFetch(`/issue/${encodeURIComponent(key)}`, {
            method: 'PUT',
            token,
            cloudId,
            body: JSON.stringify({ fields }),
          });
          if (!res.ok && res.status !== 204) {
            const text = await res.text();
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `Jira updateIssue failed (${res.status}): ${text.slice(0, 300)}`,
              mocked: false,
            };
          }
          const verified = await verifyIssue(token, cloudId, key);
          if (!verified.ok) {
            return { tool: 'jira', action, ok: false, error: `Updated ${key} but verification fetch failed.`, mocked: false };
          }
          return {
            tool: 'jira',
            action,
            ok: true,
            output: {
              key,
              url: browseUrl(siteUrl, key),
              status: verified.status,
              verified: true,
              appliedFields: Object.keys(fields),
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
          const data = (await res.json()) as { id?: string };
          const verified = await verifyIssue(token, cloudId, key);
          return {
            tool: 'jira',
            action,
            ok: true,
            output: {
              key,
              commentId: data.id,
              url: browseUrl(siteUrl, key),
              verified: verified.ok,
              status: verified.status,
            },
            mocked: false,
          };
        }

        case 'transitionIssue': {
          const key = String(input.key ?? input.issueKey ?? '').trim();
          const target = String(input.status ?? input.transition ?? input.to ?? '').trim();
          if (!key) return { tool: 'jira', action, ok: false, error: 'issue key is required', mocked: false };
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
          const match = transitions.find(
            (t) =>
              t.name.toLowerCase() === target.toLowerCase() ||
              t.to?.name?.toLowerCase() === target.toLowerCase()
          );
          if (!match) {
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `No transition matching "${target}". Available: ${transitions.map((t) => t.name).join(', ')}`,
              mocked: false,
            };
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
          const verified = await verifyIssue(token, cloudId, key);
          return {
            tool: 'jira',
            action,
            ok: true,
            output: {
              key,
              transition: match.name,
              status: verified.status,
              url: browseUrl(siteUrl, key),
              verified: verified.ok,
            },
            mocked: false,
          };
        }

        case 'linkIssues': {
          const inward = String(input.inwardKey ?? input.from ?? input.key ?? '').trim();
          const outward = String(input.outwardKey ?? input.to ?? input.linkTo ?? '').trim();
          const typeName = String(input.linkType ?? input.type ?? 'Blocks').trim();
          if (!inward || !outward) {
            return {
              tool: 'jira',
              action,
              ok: false,
              error: 'from/inwardKey and to/outwardKey are required',
              mocked: false,
            };
          }
          const res = await jiraFetch('/issueLink', {
            method: 'POST',
            token,
            cloudId,
            body: JSON.stringify({
              type: { name: typeName },
              inwardIssue: { key: inward },
              outwardIssue: { key: outward },
            }),
          });
          if (!res.ok && res.status !== 201) {
            const text = await res.text();
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `Jira linkIssues failed (${res.status}): ${text.slice(0, 300)}`,
              mocked: false,
            };
          }
          return {
            tool: 'jira',
            action,
            ok: true,
            output: { inwardKey: inward, outwardKey: outward, linkType: typeName, verified: true, url: browseUrl(siteUrl, inward) },
            mocked: false,
          };
        }

        case 'addAttachment': {
          const key = String(input.key ?? input.issueKey ?? '').trim();
          const filename = String(input.filename ?? input.name ?? 'attachment.txt').trim();
          const content = String(input.content ?? input.body ?? '');
          const contentBase64 = String(input.contentBase64 ?? '').trim();
          if (!key || (!content && !contentBase64)) {
            return { tool: 'jira', action, ok: false, error: 'key and content (or contentBase64) required', mocked: false };
          }
          const bytes = contentBase64 ? Buffer.from(contentBase64, 'base64') : Buffer.from(content, 'utf8');
          const form = new FormData();
          form.append('file', new Blob([bytes]), filename);
          const res = await fetch(`${apiBase(cloudId)}/issue/${encodeURIComponent(key)}/attachments`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'X-Atlassian-Token': 'no-check',
              Accept: 'application/json',
            },
            body: form,
          });
          if (!res.ok) {
            const text = await res.text();
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `Jira addAttachment failed (${res.status}): ${text.slice(0, 300)}`,
              mocked: false,
            };
          }
          const data = (await res.json()) as Array<{ id?: string; filename?: string }>;
          const first = Array.isArray(data) ? data[0] : undefined;
          return {
            tool: 'jira',
            action,
            ok: true,
            output: {
              key,
              attachmentId: first?.id,
              filename: first?.filename ?? filename,
              url: browseUrl(siteUrl, key),
              verified: Boolean(first?.id),
            },
            mocked: false,
          };
        }

        case 'searchIssues': {
          let jql = String(input.jql ?? '').trim();
          const q = String(input.query ?? input.summary ?? '').trim();
          const project = String(input.project ?? input.projectKey ?? process.env.JIRA_DEFAULT_PROJECT ?? '').trim();
          if (!jql) {
            if (/\bblock/i.test(q) || input.blockedOnly) {
              const proj = project ? `project = ${project.toUpperCase()} AND ` : '';
              jql = `${proj}(status = Blocked OR labels = blocked OR text ~ "blocked") ORDER BY updated DESC`;
            } else if (q.includes('=') || /\bORDER BY\b/i.test(q)) {
              jql = q;
            } else if (q) {
              const proj = project ? `project = ${project.toUpperCase()} AND ` : '';
              jql = `${proj}text ~ "${q.replace(/"/g, '\\"')}" ORDER BY updated DESC`;
            } else {
              const proj = project ? `project = ${project.toUpperCase()} AND ` : '';
              jql = `${proj}updated >= -14d ORDER BY updated DESC`;
            }
          }
          const res = await jiraFetch(
            `/search?jql=${encodeURIComponent(jql)}&maxResults=${Number(input.limit ?? 10)}&fields=summary,status,assignee,priority,labels,duedate`,
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
            assignee: issue.fields?.assignee?.displayName,
            priority: issue.fields?.priority?.name,
            labels: issue.fields?.labels,
            url: browseUrl(siteUrl, issue.key),
          }));
          const summaryText =
            results.length === 0
              ? 'No matching Jira issues.'
              : results.map((r) => `${r.key} [${r.status}] ${r.summary}`).join('\n');
          return {
            tool: 'jira',
            action,
            ok: true,
            output: { results, count: results.length, jql, summary: summaryText, verified: true },
            mocked: false,
          };
        }

        case 'listBoards': {
          const projectKey = String(input.project ?? input.projectKey ?? process.env.JIRA_DEFAULT_PROJECT ?? '').trim();
          const qs = projectKey ? `?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50` : '?maxResults=50';
          const res = await jiraFetch(`/board${qs}`, { method: 'GET', token, cloudId, agile: true });
          if (!res.ok) {
            const text = await res.text();
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `Jira listBoards failed (${res.status}): ${text.slice(0, 300)}`,
              mocked: false,
            };
          }
          const data = (await res.json()) as { values?: Array<{ id: number; name: string; type?: string }> };
          const boards = (data.values ?? []).map((b) => ({ id: b.id, name: b.name, type: b.type }));
          return { tool: 'jira', action, ok: true, output: { boards, count: boards.length, verified: true }, mocked: false };
        }

        case 'listSprints': {
          const boardId = Number(input.boardId ?? input.board);
          if (!boardId) {
            return { tool: 'jira', action, ok: false, error: 'boardId is required (use listBoards first)', mocked: false };
          }
          const state = String(input.state ?? 'active,future').trim();
          const res = await jiraFetch(`/board/${boardId}/sprint?state=${encodeURIComponent(state)}`, {
            method: 'GET',
            token,
            cloudId,
            agile: true,
          });
          if (!res.ok) {
            const text = await res.text();
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `Jira listSprints failed (${res.status}): ${text.slice(0, 300)}`,
              mocked: false,
            };
          }
          const data = (await res.json()) as {
            values?: Array<{ id: number; name: string; state?: string; startDate?: string; endDate?: string }>;
          };
          const sprints = (data.values ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            state: s.state,
            startDate: s.startDate,
            endDate: s.endDate,
          }));
          return {
            tool: 'jira',
            action,
            ok: true,
            output: { boardId, sprints, count: sprints.length, verified: true },
            mocked: false,
          };
        }

        case 'getSprintIssues': {
          const sprintId = Number(input.sprintId ?? input.sprint);
          if (!sprintId) return { tool: 'jira', action, ok: false, error: 'sprintId is required', mocked: false };
          const res = await jiraFetch(`/sprint/${sprintId}/issue?maxResults=${Number(input.limit ?? 50)}`, {
            method: 'GET',
            token,
            cloudId,
            agile: true,
          });
          if (!res.ok) {
            const text = await res.text();
            return {
              tool: 'jira',
              action,
              ok: false,
              error: `Jira getSprintIssues failed (${res.status}): ${text.slice(0, 300)}`,
              mocked: false,
            };
          }
          const data = (await res.json()) as { issues?: any[] };
          const issues = (data.issues ?? []).map((issue) => ({
            key: issue.key,
            summary: issue.fields?.summary,
            status: issue.fields?.status?.name,
            url: browseUrl(siteUrl, issue.key),
          }));
          return {
            tool: 'jira',
            action,
            ok: true,
            output: { sprintId, issues, count: issues.length, verified: true },
            mocked: false,
          };
        }

        case 'deleteIssue': {
          const key = String(input.key ?? input.issueKey ?? '').trim();
          if (!key) return { tool: 'jira', action, ok: false, error: 'issue key is required', mocked: false };
          const res = await jiraFetch(`/issue/${encodeURIComponent(key)}`, { method: 'DELETE', token, cloudId });
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
          return { tool: 'jira', action, ok: true, output: { key, deleted: true, verified: true }, mocked: false };
        }

        default:
          return { tool: 'jira', action, ok: false, error: `Unknown action: ${action}`, mocked: false };
      }
    } catch (err: any) {
      return { tool: 'jira', action, ok: false, error: err?.message ?? String(err), mocked: false };
    }
  }
}

export const jiraConnector = new JiraConnector();
