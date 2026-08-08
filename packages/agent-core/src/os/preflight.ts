import type { ToolCall, ToolCallResult, ToolName } from '@enterprise-ai-os/shared';
import {
  getConnector,
  isLiveMode,
  slackService,
  getConnectorContext,
  hasSlackTokenInContext,
  hasNotionTokenInContext,
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

    // Infer missing channel → general
    if (
      ['postMessage', 'getChannelHistory', 'summarizeChannel', 'uploadFile', 'setChannelTopic', 'createBookmark', 'pinMessage'].includes(
        call.action
      )
    ) {
      if (!input.channel) {
        input.channel = process.env.SLACK_DEFAULT_CHANNEL_ID || 'general';
        healActions.push('inferred_channel_general');
      }
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
      initializeNotionClient(ctx.notionToken);
      healActions.push('notion_client_ready');
    } catch (err: any) {
      return {
        ok: false,
        input,
        healActions,
        fatal: err?.message ?? 'Connect your Notion workspace to continue.',
      };
    }
    if (!input.title && (call.action.startsWith('create') || call.action === 'createPage')) {
      input.title = `Nexora Note ${new Date().toISOString().slice(0, 10)}`;
      healActions.push('inferred_notion_title');
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
      return Boolean(output.ts || output.ok);
    }
    if (call.tool === 'slack' && call.action === 'createWarRoom') {
      const channel = (output.channel || {}) as { id?: string };
      return Boolean(channel.id);
    }
    if (call.tool === 'slack' && call.action === 'createIncident') {
      const channel = (output.channel || {}) as { id?: string };
      return Boolean(channel.id);
    }
    if (call.tool === 'notion' && (call.action === 'createPage' || call.action === 'createProject' || call.action === 'createPRD' || call.action === 'createWiki' || call.action === 'createMeetingNotes' || call.action === 'createDatabase')) {
      return Boolean(output.id || output.url);
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
  // Preserve explicit connect / isolation messages for SaaS users
  if (/not connected|Connect (Slack|Notion)|Integrations/i.test(msg)) {
    return msg;
  }
  if (/rate.?limit/i.test(msg)) return `${tool} is rate-limiting right now — Nexora backed off and can retry shortly.`;
  if (/missing_scope|missing.?permissions|requires .+ scope|pins:write/i.test(msg))
    return `${tool}.${action} needs an extra permission. Re-authorize the app in Integrations (include the new scopes), then ask again.`;
  if (/invalid.?token|not.?authed|token_revoked|token_expired|authentication/i.test(msg) && !/pins:write|missing_scope|permission/i.test(msg))
    return `${tool} authentication expired. Reconnect ${tool} under Integrations, then retry.`;
  if (/not_in_channel|channel_not_found/i.test(msg))
    return `I couldn't access that Slack channel yet. Invite @nexora-agent or ask me to create it.`;
  if (/name_taken/i.test(msg)) return `That channel name was taken — I should have auto-created a unique name. Please retry.`;
  return `I hit a recoverable issue on ${tool}.${action}. Diagnosing and retrying when possible.`;
}
