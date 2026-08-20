import type { ToolCall, ToolCallResult, ToolName } from '@enterprise-ai-os/shared';
import {
  getConnector,
  isLiveMode,
  slackService,
  getConnectorContext,
  hasSlackTokenInContext,
  hasNotionTokenInContext,
  hasJiraTokenInContext,
  hasGmailTokenInContext,
} from '@enterprise-ai-os/connectors';

// ============================================================
// STEP 4 — Pre-execution validation
// Never fail immediately: validate OAuth, channels, membership,
// and infer missing parameters before the real tool call.
// ============================================================

export interface PreflightResult {
  ok: boolean;
  input: Record<string, unknown>;
  healActions: string[];
  fatal?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function preflightToolCall(call: ToolCall): Promise<PreflightResult> {
  const healActions: string[] = [];
  const input = { ...call.input };
  const ctx = getConnectorContext();

  if (call.tool === 'slack') {
    // Connected OAuth / env token ⇒ live. Only fail on missing connection.
    if (!hasSlackTokenInContext() && !isLiveMode('slack')) {
      return {
        ok: false,
        input,
        healActions,
        fatal: 'Slack is not connected. Open Integrations → Connect Slack, then ask again.',
      };
    }
    if (!hasSlackTokenInContext()) {
      return {
        ok: false,
        input,
        healActions,
        fatal:
          'Slack is not connected for this workspace. Open Integrations → Connect Slack, then ask again.',
      };
    }
    try {
      slackService.initializeClient(ctx.slackBotToken);
      await slackService.authTest();
      healActions.push('oauth_valid');
    } catch (err: any) {
      return {
        ok: false,
        input,
        healActions,
        fatal: `Slack OAuth/token invalid: ${err?.message ?? err}. Reconnect Slack in Integrations.`,
      };
    }

    const isWritePost =
      call.action === 'postMessage' || call.action === 'postMessageExternalChannel';

    if (isWritePost) {
      const text = String(input.text ?? '').trim();
      if (!text) {
        return {
          ok: false,
          input,
          healActions,
          fatal: 'Slack post needs message text. Re-ask with the exact words to post.',
        };
      }
      input.text = text;
      if (!String(input.channel ?? '').trim()) {
        return {
          ok: false,
          input,
          healActions,
          fatal:
            'Slack post needs a channel (e.g. #ops). Re-ask with the channel — Nexora will not invent #general for gated posts.',
        };
      }
    }

    // Infer missing channel → general (reads / soft writes only — never invent for gated posts)
    if (
      ['getChannelHistory', 'summarizeChannel', 'uploadFile', 'setChannelTopic', 'createBookmark', 'pinMessage'].includes(
        call.action
      )
    ) {
      if (!input.channel) {
        input.channel = process.env.SLACK_DEFAULT_CHANNEL_ID || 'general';
        healActions.push('inferred_channel_general');
      }
    }

    if (
      [
        'postMessage',
        'postMessageExternalChannel',
        'getChannelHistory',
        'summarizeChannel',
        'uploadFile',
        'setChannelTopic',
        'createBookmark',
        'pinMessage',
      ].includes(call.action)
    ) {
      // Try resolve / auto-join public channels
      try {
        const id = await slackService.resolveChannelId(String(input.channel));
        input.channel = id;
        healActions.push('resolved_channel');
        try {
          await slackService.getClient().conversations.join({ channel: id });
          healActions.push('joined_channel');
        } catch (joinErr: any) {
          if (/already_in_channel/i.test(String(joinErr?.message || joinErr?.code || ''))) {
            healActions.push('already_in_channel');
          } else if (isWritePost) {
            // For gated posts, soft-fail membership so Approve & run can still attempt + return a clear Slack error
            healActions.push('join_failed_will_retry_on_execute');
          }
          // private / missing scope — continue
        }
      } catch (err: any) {
        const name = String(input.channel).replace(/^#/, '') || 'nexora-auto';
        // For read/history: fall back to default channel or first member channel
        if (['getChannelHistory', 'summarizeChannel'].includes(call.action)) {
          const fallback = process.env.SLACK_DEFAULT_CHANNEL_ID?.trim();
          if (fallback) {
            input.channel = fallback;
            healActions.push('history_fallback_default_channel');
          } else {
            try {
              const channels = await slackService.listChannels(30);
              const member = channels.find((c) => c.is_member !== false);
              if (member?.id) {
                input.channel = member.id;
                healActions.push(`history_fallback_member:${member.name}`);
              }
            } catch {
              return { ok: false, input, healActions, fatal: err?.message ?? String(err) };
            }
          }
        } else if (isWritePost) {
          return {
            ok: false,
            input,
            healActions,
            fatal: `Slack channel #${name} not found or bot cannot access it. Invite @Nexora to that channel, then ask again.`,
          };
        } else if (/not found|channel_not_found/i.test(String(err?.message))) {
          try {
            const created = await slackService.createChannel({ name });
            input.channel = created.id;
            healActions.push(`created_missing_channel:${created.name}`);
          } catch (createErr: any) {
            return { ok: false, input, healActions, fatal: createErr?.message ?? String(createErr) };
          }
        }
      }
    }

    if (call.action === 'createChannel' && !input.name) {
      input.name = `nexora-${Date.now().toString(36).slice(-5)}`;
      healActions.push('inferred_channel_name');
    }

    if (call.action === 'inviteUsers' && (!input.users || (Array.isArray(input.users) && !input.users.length))) {
      const people = await slackService.findUsersByRole(['eng', 'product'], 2);
      if (people.length) {
        input.users = people.map((p) => p.id);
        healActions.push(`inferred_users:${people.length}`);
      }
    }
  }

  if (call.tool === 'notion') {
    if (!hasNotionTokenInContext() && !isLiveMode('notion')) {
      return {
        ok: false,
        input,
        healActions,
        fatal: 'Notion is not connected. Open Integrations → Connect Notion, then ask again.',
      };
    }
    if (!hasNotionTokenInContext()) {
      return {
        ok: false,
        input,
        healActions,
        fatal:
          'Notion is not connected for this workspace. Open Integrations → Connect Notion, then ask again.',
      };
    }
    try {
      const { initializeNotionClient } = await import('@enterprise-ai-os/connectors');
      const client = initializeNotionClient(ctx.notionToken);
      healActions.push('notion_client_ready');

      const writeActions = [
        'createPage',
        'updatePage',
        'createDatabaseEntry',
        'createDatabase',
        'createProject',
        'createMeetingNotes',
        'createPRD',
        'createWiki',
        'createRoadmap',
      ];
      if (writeActions.includes(call.action)) {
        if (!input.title && call.action !== 'updatePage') {
          input.title = `Nexora Note ${new Date().toISOString().slice(0, 10)}`;
          healActions.push('inferred_notion_title');
        }
        // updatePage: explicit pageId → conversation memory → org memory → title search (ask if ambiguous)
        if (call.action === 'updatePage') {
          let pageId = String(input.pageId ?? input.id ?? '').trim();
          if (!pageId) {
            try {
              const { recall } = await import('./threadMemory');
              const orgId =
                String(input._organizationId ?? '').trim() ||
                String(getConnectorContext().organizationId ?? '').trim();
              const convId = String(input._conversationId ?? '').trim();
              if (orgId && convId) {
                const latestConv = await recall(orgId, `notion:page:conversation:${convId}:latest`);
                const memId = String(latestConv?.pageId ?? '').trim();
                if (memId) {
                  pageId = memId;
                  input.pageId = memId;
                  if (latestConv?.url) input.pageUrl = latestConv.url;
                  healActions.push('resolved_notion_pageId_from_conversation_memory');
                }
              }
              if (!pageId && orgId) {
                const latest = await recall(orgId, 'notion:page:latest');
                const memId = String(latest?.pageId ?? '').trim();
                if (memId) {
                  pageId = memId;
                  input.pageId = memId;
                  if (latest?.url) input.pageUrl = latest.url;
                  healActions.push('resolved_notion_pageId_from_memory');
                }
              }
            } catch {
              // ignore
            }
          }
          // After memory: exact-title search — one safe match continues; many → ask with candidates
          if (!pageId) {
            const titleQuery = String(input.title ?? '').trim();
            if (titleQuery) {
              try {
                const response = await client.search({
                  query: titleQuery,
                  filter: { property: 'object', value: 'page' },
                  page_size: 25,
                });
                const pages = (response.results as any[]) ?? [];
                const extractTitle = (page: any): string => {
                  const props = page?.properties || {};
                  for (const key of Object.keys(props)) {
                    const prop = props[key];
                    if (prop?.type === 'title' && Array.isArray(prop.title)) {
                      return prop.title.map((t: any) => t.plain_text || '').join('').trim();
                    }
                  }
                  return String(page?.id || '');
                };
                const normalized = titleQuery.toLowerCase();
                const matches = pages.filter(
                  (p) => extractTitle(p).trim().toLowerCase() === normalized
                );
                if (matches.length === 1) {
                  pageId = String(matches[0].id);
                  input.pageId = pageId;
                  if (matches[0].url) input.pageUrl = matches[0].url;
                  healActions.push('resolved_notion_pageId_from_unique_title');
                } else if (matches.length > 1) {
                  const choices = matches.slice(0, 5).map((p) => {
                    const id = String(p.id);
                    const url = String(p.url || '');
                    return `• ${extractTitle(p)} — pageId \`${id}\`${url ? ` (${url})` : ''}`;
                  });
                  return {
                    ok: false,
                    input,
                    healActions,
                    fatal:
                      `I found ${matches.length} Notion pages titled “${titleQuery}”. Which one should I update?\n\n` +
                      `${choices.join('\n')}\n\n` +
                      `Reply with the pageId (or open the page in Timeline). I will not guess.`,
                  };
                } else {
                  return {
                    ok: false,
                    input,
                    healActions,
                    fatal:
                      `I could not find a Notion page titled “${titleQuery}” that Nexora can access. ` +
                      `Share the pageId from a Nexora-created page in this conversation / Timeline, or create the page first.`,
                  };
                }
              } catch (err) {
                return {
                  ok: false,
                  input,
                  healActions,
                  fatal: `Notion title lookup failed: ${(err as Error).message}`,
                };
              }
            }
          }
          if (!pageId) {
            return {
              ok: false,
              input,
              healActions,
              fatal:
                'Notion update needs an exact pageId (from a Nexora-created page in this conversation / Timeline). Title-only updates are refused when no unique page can be resolved.',
            };
          }
          input.pageId = pageId;
          delete input.allowTitleResolve;
          delete input._allowTitleResolve;
        }
        // Prove a shared parent exists before we queue Approve & run
        if (!input.parentPageId && call.action !== 'updatePage') {
          const pageSearch = await client.search({
            filter: { property: 'object', value: 'page' },
            page_size: 5,
          });
          const pages = (pageSearch.results as any[]) ?? [];
          if (!pages.length) {
            return {
              ok: false,
              input,
              healActions,
              fatal:
                'Notion has no shared parent page for Nexora yet. In Notion: open a page → ··· → Connections → add Nexora, then reconnect under Integrations.',
            };
          }
          healActions.push('notion_parent_available');
        }
      }
    } catch (err: any) {
      return {
        ok: false,
        input,
        healActions,
        fatal: err?.message ?? 'Connect your Notion workspace to continue.',
      };
    }
  }

  if (call.tool === 'gmail') {
    const gmailErr = getConnectorContext().gmailAuthError?.trim();
    if (gmailErr) {
      return {
        ok: false,
        input,
        healActions,
        fatal: gmailErr,
      };
    }
    if (!hasGmailTokenInContext()) {
      return {
        ok: false,
        input,
        healActions,
        fatal:
          "Your Gmail isn't connected to this workspace yet. You can connect it from Integrations.",
      };
    }
  }

  if (call.tool === 'jira') {
    const ctxErr = getConnectorContext().jiraAuthError?.trim();
    if (ctxErr) {
      return {
        ok: false,
        input,
        healActions,
        fatal: ctxErr,
      };
    }
    if (!hasJiraTokenInContext()) {
      return {
        ok: false,
        input,
        healActions,
        fatal: 'Jira is not connected for this workspace. Open Integrations → Connect Jira, then ask again.',
      };
    }
    if (call.action === 'createIssue') {
      const summary = String(input.summary ?? input.title ?? '').trim();
      if (!summary) {
        return {
          ok: false,
          input,
          healActions,
          fatal: 'Jira create needs a summary/title. Re-ask with a clear ticket title.',
        };
      }
      input.summary = summary.slice(0, 255);

      let project = String(
        input.project ?? input.projectKey ?? process.env.JIRA_DEFAULT_PROJECT ?? ''
      )
        .trim()
        .toUpperCase();

      const token = ctx.jiraToken?.trim();
      const cloudId = ctx.jiraCloudId?.trim();
      if (!token || !cloudId) {
        return {
          ok: false,
          input,
          healActions,
          fatal:
            'Jira auth is incomplete (missing token or site). Open Integrations → Disconnect Jira → Connect Jira, then retry.',
        };
      }

      // Auth probe first — distinguish expired token from bad project key
      try {
        const me = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (me.status === 401) {
          return {
            ok: false,
            input,
            healActions,
            fatal:
              'Jira auth expired or invalid (401). Open Integrations → Disconnect Jira → Connect Jira, then retry Approve & run.',
          };
        }
        if (!me.ok) {
          const body = await me.text();
          return {
            ok: false,
            input,
            healActions,
            fatal: `Jira auth check failed (${me.status}). ${body.slice(0, 120)} Reconnect Jira under Integrations if this persists.`,
          };
        }
        healActions.push('validated_jira_auth');
      } catch (err: any) {
        return {
          ok: false,
          input,
          healActions,
          fatal: `Could not reach Jira auth check: ${err?.message ?? err}`,
        };
      }

      if (project) {
        try {
          const res = await fetch(
            `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(project)}`,
            {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            }
          );
          if (res.status === 401) {
            return {
              ok: false,
              input,
              healActions,
              fatal:
                'Jira auth expired or invalid (401). Open Integrations → Disconnect Jira → Connect Jira, then retry.',
            };
          }
          if (res.status === 403) {
            return {
              ok: false,
              input,
              healActions,
              fatal: `You do not have access to Jira project “${project}” (403). Pick another project key in Chat or ask a Jira admin for access.`,
            };
          }
          if (res.status === 404 || !res.ok) {
            // Wrong default (e.g. stale JIRA_DEFAULT_PROJECT=ATLAS) — clear and let connector discover
            console.warn('[preflight] jira_project_unavailable', {
              project,
              status: res.status,
            });
            delete input.project;
            delete input.projectKey;
            project = '';
            healActions.push('cleared_invalid_jira_project');
          } else {
            healActions.push('validated_jira_project');
            input.project = project;
            input.projectKey = project;
          }
        } catch (err: any) {
          return {
            ok: false,
            input,
            healActions,
            fatal: `Could not validate Jira project “${project}”: ${err?.message ?? err}`,
          };
        }
      }

      if (!project) {
        // Discover a real project via search (no hardcoded keys)
        try {
          const list = await fetch(
            `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search?maxResults=20`,
            { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
          );
          if (list.status === 401) {
            return {
              ok: false,
              input,
              healActions,
              fatal:
                'Jira auth expired or invalid (401). Open Integrations → Disconnect Jira → Connect Jira, then retry.',
            };
          }
          if (!list.ok) {
            const body = await list.text();
            return {
              ok: false,
              input,
              healActions,
              fatal: `Could not list Jira projects (${list.status}). ${body.slice(0, 120)}`,
            };
          }
          const data = (await list.json()) as { values?: Array<{ key: string }> };
          const keys = (data.values ?? []).map((p) => p.key).filter(Boolean);
          if (!keys.length) {
            return {
              ok: false,
              input,
              healActions,
              fatal:
                'No Jira projects found on this site. Create a project in Jira (or get access), then retry with “in project KEY”.',
            };
          }
          // Bind a real project from the live API (never invent keys like ATLAS).
          project = keys[0].toUpperCase();
          input.project = project;
          input.projectKey = project;
          input._availableProjects = keys.slice(0, 12);
          healActions.push('resolved_jira_project_from_api');
        } catch (err: any) {
          return {
            ok: false,
            input,
            healActions,
            fatal: `Could not list Jira projects: ${err?.message ?? err}`,
          };
        }
      }
    } else if (!input.summary && call.action.startsWith('create')) {
      input.summary = `Nexora task ${new Date().toISOString().slice(0, 10)}`;
      healActions.push('inferred_jira_summary');
    }
  }

  return { ok: true, input, healActions };
}

export async function verifyToolResult(call: ToolCall, result: ToolCallResult): Promise<boolean> {
  if (!result.ok || result.mocked) return false;
  const output = (result.output || {}) as Record<string, unknown>;

  try {
    if (call.tool === 'slack' && call.action === 'createChannel') {
      if (!output.id) return false;
      const info = await slackService.getClient().conversations.info({ channel: String(output.id) });
      return Boolean((info as any).ok && (info as any).channel?.id);
    }
    if (call.tool === 'slack' && (call.action === 'postMessage' || call.action === 'postMessageExternalChannel')) {
      const ts = output.ts;
      const channel = output.channel;
      if (!ts || !channel) return false;
      try {
        const hist = await slackService.getClient().conversations.history({
          channel: String(channel),
          latest: String(ts),
          oldest: String(ts),
          inclusive: true,
          limit: 1,
        });
        return Boolean((hist as any).ok && Array.isArray((hist as any).messages) && (hist as any).messages.length > 0);
      } catch {
        // Never soft-pass: unverified Slack posts must fail like Jira P0.1
        return false;
      }
    }
    if (call.tool === 'slack' && call.action === 'createWarRoom') {
      const channel = (output.channel || {}) as { id?: string };
      const id = String(channel.id ?? output.id ?? '').trim();
      if (!id) return false;
      try {
        const info = await slackService.getClient().conversations.info({ channel: id });
        return Boolean((info as any).ok && (info as any).channel?.id);
      } catch {
        return false;
      }
    }
    if (call.tool === 'slack' && call.action === 'createIncident') {
      const channel = (output.channel || {}) as { id?: string };
      const id = String(channel.id ?? output.id ?? '').trim();
      if (!id) return false;
      try {
        const info = await slackService.getClient().conversations.info({ channel: id });
        return Boolean((info as any).ok && (info as any).channel?.id);
      } catch {
        return false;
      }
    }
    if (call.tool === 'slack' && (call.action === 'updateMessage' || call.action === 'deleteMessage')) {
      return Boolean(output.ts || call.input?.ts);
    }
    if (call.tool === 'slack' && call.action === 'openDm') {
      return Boolean(output.channel);
    }
    if (call.tool === 'slack' && call.action === 'joinChannel') {
      return Boolean(output.id || output.channel);
    }
    if (call.tool === 'slack' && call.action === 'inviteUsers') {
      const channel = String(output.channel ?? call.input?.channel ?? '').trim();
      if (!channel) return false;
      const invited = (output.invited as string[] | undefined) ?? [];
      const already = (output.alreadyMembers as string[] | undefined) ?? [];
      const need = [...invited, ...already].filter(Boolean);
      if (!need.length) return false;
      try {
        const members = await slackService.getClient().conversations.members({ channel, limit: 200 });
        const set = new Set<string>(((members as any).members ?? []) as string[]);
        return need.every((id) => set.has(id));
      } catch {
        return false;
      }
    }
    if (call.tool === 'slack' && (call.action === 'searchHistory' || call.action === 'searchMessages')) {
      return Array.isArray(output.matches) || typeof output.count === 'number' || Array.isArray(output.messages);
    }
    if (call.tool === 'jira' && (call.action === 'createIssue' || call.action === 'addComment' || call.action === 'transitionIssue')) {
      return Boolean(output.key || output.id);
    }
    if (
      call.tool === 'notion' &&
      (call.action === 'createPage' ||
        call.action === 'updatePage' ||
        call.action === 'createDatabaseEntry' ||
        call.action === 'createProject' ||
        call.action === 'createPRD' ||
        call.action === 'createWiki' ||
        call.action === 'createMeetingNotes' ||
        call.action === 'createRoadmap' ||
        call.action === 'createDatabase')
    ) {
      const id = String(output.id ?? output.url ?? '').trim();
      if (!id) return false;
      try {
        const { initializeNotionClient } = await import('@enterprise-ai-os/connectors');
        const client = initializeNotionClient();
        if (call.action === 'createDatabase') {
          const db = await (client.databases as any).retrieve({ database_id: String(output.id) });
          return Boolean(db?.id);
        }
        const page = await client.pages.retrieve({ page_id: String(output.id) });
        return Boolean((page as any)?.id);
      } catch {
        // Never soft-pass: unverified Notion writes must fail like Jira P0.1
        return false;
      }
    }
    // Gmail reads: trust live connector ids; Salesforce writes must never soft-pass
    if (call.tool === 'gmail') {
      if (call.action === 'searchEmails') {
        return Array.isArray(output.emails) || typeof output.count === 'number' || typeof output.query === 'string';
      }
      if (call.action === 'getEmail' || call.action === 'getThread') {
        return Boolean(output.email || output.id || output.messageCount != null || output.thread);
      }
      if (call.action === 'sendEmail') {
        return Boolean(output.id || output.messageId || output.url);
      }
      return false;
    }
    if (call.tool === 'salesforce') {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function classifyFailure(error?: string): 'retryable_failure' | 'fatal_failure' {
  const msg = String(error || '').toLowerCase();
  if (!msg) return 'fatal_failure';
  if (/rate.?limit|ratelimited|timeout|etimedout|econnreset|unreachable|temporarily|try again|name_taken|not_in_channel|channel_not_found|missing_scope/.test(msg)) {
    return 'retryable_failure';
  }
  if (/invalid.?token|not.?authed|token_revoked|unauthorized|forbidden/.test(msg)) {
    return 'fatal_failure';
  }
  return 'retryable_failure';
}

export async function withBackoff<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      last = err;
      const msg = String(err?.message || err);
      if (/ratelimit|rate_limited/i.test(msg)) {
        await sleep(1500 * (i + 1) * (i + 1));
        continue;
      }
      if (classifyFailure(msg) === 'fatal_failure') throw err;
      await sleep(400 * Math.pow(2, i));
    }
  }
  throw last;
}

export async function healAndRetry(
  call: ToolCall,
  previousError: string
): Promise<{ call: ToolCall; healActions: string[] } | null> {
  const healActions: string[] = [];
  const next = { ...call, input: { ...call.input } };
  const msg = previousError.toLowerCase();

  if (call.tool === 'slack') {
    if (/name_taken/.test(msg) && call.action === 'createChannel') {
      next.input.name = `${String(next.input.name || 'channel').slice(0, 60)}-${Date.now().toString(36).slice(-4)}`;
      healActions.push('unique_channel_name');
      return { call: next, healActions };
    }
    if (/not_in_channel|channel_not_found/.test(msg)) {
      try {
        const channel = String(next.input.channel || 'general');
        const id = await slackService.resolveChannelId(channel);
        try {
          await slackService.getClient().conversations.join({ channel: id });
          healActions.push('joined_channel_retry');
        } catch {
          const created = await slackService.createChannel({ name: String(channel).replace(/^#/, '') || 'nexora-auto' });
          next.input.channel = created.id;
          healActions.push('created_channel_retry');
        }
        next.input.channel = next.input.channel || id;
        return { call: next, healActions };
      } catch {
        return null;
      }
    }
    if (/missing_scope|missing permissions/.test(msg)) {
      // Cannot auto-fix scopes — fatal at heal layer
      return null;
    }
  }

  if (call.tool === 'notion' && /not found|object_not_found|page/.test(msg)) {
    if (call.action === 'deletePage' || call.action === 'publishPage') {
      // Switch to create if target missing
      next.action = 'createPage';
      healActions.push('notion_create_instead_of_update');
      return { call: next, healActions };
    }
  }

  return healActions.length ? { call: next, healActions } : null;
}

/** Soft user-facing error — never dump raw API payloads. */
export function humanizeError(tool: ToolName, action: string, error?: string): string {
  const msg = String(error || 'unknown issue');
  // Preserve explicit connect / isolation / parent-share messages for SaaS users
  if (/not connected|Connect (Slack|Notion)|Integrations|shared parent|Connections → add Nexora|select at least one page/i.test(msg)) {
    return msg;
  }
  if (/object_not_found|could not find|page_id|database_id|parent/i.test(msg) && tool === 'notion') {
    return 'Notion could not use a parent page yet. Reconnect Notion and select at least one page to share, or in Notion open a page → ··· → Connections → add Nexora, then retry.';
  }
  if (/rate.?limit/i.test(msg)) return `${tool === 'gmail' ? 'Gmail' : tool} is rate-limiting right now — please try again shortly.`;
  if (/missing_scope|missing.?permissions|requires .+ scope|pins:write/i.test(msg))
    return `${tool === 'gmail' ? 'Gmail' : tool === 'slack' ? 'Slack' : tool} needs an extra permission. Re-authorize under Integrations, then ask again.`;
  if (/invalid.?token|not.?authed|token_revoked|token_expired|authentication/i.test(msg) && !/pins:write|missing_scope|permission/i.test(msg))
    return `${tool === 'gmail' ? 'Gmail' : tool === 'slack' ? 'Slack' : tool === 'jira' ? 'Jira' : tool === 'notion' ? 'Notion' : tool} authentication expired. Reconnect under Integrations, then retry.`;
  if (/not_in_channel|channel_not_found/i.test(msg))
    return `I couldn't access that Slack channel yet. Invite @nexora-agent or ask me to create it.`;
  if (/name_taken/i.test(msg)) return `That channel name was taken — I should have auto-created a unique name. Please retry.`;
  const product =
    tool === 'gmail' ? 'Gmail' : tool === 'slack' ? 'Slack' : tool === 'jira' ? 'Jira' : tool === 'notion' ? 'Notion' : tool;
  return `I couldn't complete that because ${product} didn't respond. Nothing was changed.`;
}
