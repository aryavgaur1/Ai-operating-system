import type { ActionOutcome, ToolCall, ToolCallResult, ToolName } from '@enterprise-ai-os/shared';

function asRecord(output: unknown): Record<string, unknown> {
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : {};
}

function integrationLabel(tool: ToolName): string {
  if (tool === 'gmail') return 'Gmail';
  if (tool === 'slack') return 'Slack';
  if (tool === 'jira') return 'Jira';
  if (tool === 'notion') return 'Notion';
  return tool;
}

function openLabel(tool: ToolName, action: string): string | undefined {
  if (tool === 'jira') return 'Open in Jira';
  if (tool === 'notion') return 'Open in Notion';
  if (tool === 'gmail') return action === 'sendEmail' ? 'Open in Gmail' : undefined;
  if (tool === 'slack') {
    if (action === 'createWarRoom' || action === 'createChannel' || action === 'createIncident') {
      return 'Open in Slack';
    }
    if (action === 'postMessage' || action === 'postMessageExternalChannel') return 'Open in Slack';
  }
  return undefined;
}

function extractOne(
  call: ToolCallResult,
  planned?: ToolCall
): ActionOutcome {
  const action = `${call.tool}.${call.action}`;
  const output = asRecord(call.output);
  const input = asRecord(planned?.input);
  const integration = call.tool;

  if (!call.ok || call.mocked) {
    return {
      status: 'failed',
      action,
      integration,
      summary: call.error || `${integrationLabel(integration)} did not complete this action.`,
      timestamp: new Date().toISOString(),
    };
  }

  const resourceUrl = typeof output.url === 'string' && output.url.startsWith('http') ? output.url : undefined;

  if (integration === 'jira') {
    const key = String(output.key || output.issueKey || input.issueKey || '').trim();
    const summary =
      call.action === 'createIssue'
        ? key
          ? `Created Jira issue ${key}`
          : 'Created Jira issue'
        : call.action === 'searchIssues'
          ? `Found ${Number(output.count ?? (output.results as unknown[] | undefined)?.length ?? 0)} Jira tasks`
          : key
            ? `Jira ${key} updated`
            : 'Finished in Jira';
    return {
      status: 'success',
      action,
      integration,
      summary,
      resource: key || undefined,
      resourceUrl,
      resourceType: 'jira_issue',
      externalId: key || undefined,
      timestamp: new Date().toISOString(),
    };
  }

  if (integration === 'notion') {
    const title = String(output.title || input.title || 'Notion page').trim();
    const id = String(output.id || '').trim();
    const summary =
      call.action === 'searchPages'
        ? `Found ${Number((output.results as unknown[] | undefined)?.length ?? 0)} Notion pages`
        : call.action === 'createPage'
          ? `Created Notion page “${title}”`
          : `Updated Notion page`;
    return {
      status: 'success',
      action,
      integration,
      summary,
      resource: title || id || undefined,
      resourceUrl,
      resourceType: 'notion_page',
      externalId: id || undefined,
      timestamp: new Date().toISOString(),
    };
  }

  if (integration === 'slack') {
    const channelName = String(
      output.channelName || output.name || input.channel || input.name || ''
    ).replace(/^#/, '');
    const channelId = String(output.id || output.channel || '').trim();
    let summary = 'Finished in Slack';
    if (call.action === 'createWarRoom' || call.action === 'createChannel') {
      summary = channelName ? `Launch war room #${channelName} is ready` : 'Slack channel created';
    } else if (call.action === 'postMessage' || call.action === 'postMessageExternalChannel') {
      summary = channelName ? `Posted to #${channelName}` : 'Posted to Slack';
    } else if (call.action === 'searchHistory' || call.action === 'searchMessages') {
      const count = Number((output.matches as unknown[] | undefined)?.length ?? (output.messages as unknown[] | undefined)?.length ?? 0);
      summary = `Found ${count} Slack message${count === 1 ? '' : 's'}`;
    }
    return {
      status: 'success',
      action,
      integration,
      summary,
      resource: channelName ? `#${channelName}` : channelId || undefined,
      resourceUrl,
      resourceType: call.action.includes('Channel') || call.action.includes('WarRoom') ? 'slack_channel' : 'slack_message',
      externalId: channelId || undefined,
      timestamp: new Date().toISOString(),
    };
  }

  if (integration === 'gmail') {
    if (call.action === 'searchEmails') {
      const count = Number(output.count ?? (output.emails as unknown[] | undefined)?.length ?? 0);
      return {
        status: 'success',
        action,
        integration,
        summary: count ? `Found ${count} email${count === 1 ? '' : 's'}` : 'No matching emails found',
        timestamp: new Date().toISOString(),
      };
    }
    if (call.action === 'sendEmail') {
      const to = String(output.to || input.to || '').trim();
      const subject = String(output.subject || input.subject || '').trim();
      return {
        status: 'success',
        action,
        integration,
        summary: to ? `Email sent to ${to}` : 'Email sent',
        resource: subject || undefined,
        resourceUrl,
        resourceType: 'gmail_message',
        externalId: String(output.id || output.messageId || '').trim() || undefined,
        timestamp: new Date().toISOString(),
      };
    }
    if (call.action === 'getEmail') {
      const email = asRecord(output.email);
      const meta = asRecord(email.metadata);
      const subject = String(meta.subject || email.title || 'Email').trim();
      return {
        status: 'success',
        action,
        integration,
        summary: `Opened email: ${subject}`,
        resource: subject,
        resourceUrl,
        resourceType: 'gmail_message',
        externalId: String(output.id || email.externalId || '').trim() || undefined,
        timestamp: new Date().toISOString(),
      };
    }
  }

  const resource = String(output.key || output.id || output.name || '').trim() || undefined;
  return {
    status: 'success',
    action,
    integration,
    summary: `Completed ${action}`,
    resource,
    resourceUrl,
    externalId: resource,
    timestamp: new Date().toISOString(),
  };
}

export function extractActionOutcomes(
  executedCalls: ToolCallResult[],
  planToolCalls: ToolCall[] = [],
  pendingApprovalIds: string[] = []
): ActionOutcome[] {
  const outcomes = executedCalls.map((call, idx) => extractOne(call, planToolCalls[idx]));

  for (const id of pendingApprovalIds) {
    const pendingCall = planToolCalls.find((c) => c.requiresApproval);
    outcomes.push({
      status: 'pending_approval',
      action: pendingCall ? `${pendingCall.tool}.${pendingCall.action}` : 'pending',
      integration: pendingCall?.tool ?? 'slack',
      summary: pendingCall
        ? `${integrationLabel(pendingCall.tool)} action ready for approval`
        : 'Action ready for approval',
      externalId: id,
      timestamp: new Date().toISOString(),
    });
  }

  return outcomes;
}

export function openLinkLabel(outcome: ActionOutcome): string | undefined {
  if (!outcome.resourceUrl) return undefined;
  const [tool, action] = outcome.action.split('.');
  return openLabel(tool as ToolName, action || '');
}
