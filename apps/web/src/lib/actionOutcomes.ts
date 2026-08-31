import type { ToolCallResult } from '@/lib/api';

export interface ActionOutcomeView {
  status: 'success' | 'failed' | 'pending_approval';
  action: string;
  integration: string;
  summary: string;
  resource?: string;
  resourceUrl?: string;
  resourceType?: string;
  externalId?: string;
}

const OPEN_LABELS: Record<string, string> = {
  jira: 'Open in Jira',
  notion: 'Open in Notion',
  gmail: 'Open in Gmail',
  slack: 'Open in Slack',
};

function asRecord(output: unknown): Record<string, unknown> {
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : {};
}

export function openLabelFor(integration: string): string {
  return OPEN_LABELS[integration] || 'Open resource';
}

export function outcomesFromTurn(
  executedCalls: ToolCallResult[] = [],
  pendingApprovalIds: string[] = [],
  planToolCalls: Array<{ tool: string; action: string; requiresApproval?: boolean; input?: Record<string, unknown> }> = []
): ActionOutcomeView[] {
  const outcomes: ActionOutcomeView[] = executedCalls.map((call, idx) => {
    const output = asRecord(call.output);
    const input = asRecord(planToolCalls[idx]?.input);
    const action = `${call.tool}.${call.action}`;
    if (!call.ok || call.mocked) {
      return {
        status: 'failed',
        action,
        integration: call.tool,
        summary: call.error || `${call.tool} did not complete.`,
      };
    }
    const resourceUrl = typeof output.url === 'string' && output.url.startsWith('http') ? output.url : undefined;
    let resource: string | undefined;
    let summary = `Completed ${action}`;

    if (call.tool === 'jira') {
      resource = String(output.key || output.issueKey || '').trim() || undefined;
      summary = resource ? `Created Jira issue ${resource}` : summary;
    } else if (call.tool === 'notion') {
      resource = String(output.title || input.title || '').trim() || undefined;
      summary = resource ? `Created Notion page “${resource}”` : 'Notion page created';
    } else if (call.tool === 'slack') {
      resource = String(output.channelName || output.name || input.channel || '')
        .replace(/^#/, '');
      if (resource) resource = `#${resource}`;
      if (call.action === 'createWarRoom' || call.action === 'createChannel') {
        summary = resource ? `Launch war room ${resource} is ready` : 'Slack channel created';
      }
    } else if (call.tool === 'gmail' && call.action === 'sendEmail') {
      resource = String(output.to || input.to || '').trim() || undefined;
      summary = resource ? `Email sent to ${resource}` : 'Email sent';
    }

    return {
      status: 'success',
      action,
      integration: call.tool,
      summary,
      resource,
      resourceUrl,
      externalId: String(output.id || output.key || '').trim() || undefined,
    };
  });

  if (pendingApprovalIds.length) {
    const pending = planToolCalls.find((c) => c.requiresApproval) || planToolCalls[0];
    outcomes.push({
      status: 'pending_approval',
      action: pending ? `${pending.tool}.${pending.action}` : 'pending',
      integration: pending?.tool || 'slack',
      summary: 'Action ready for approval',
      externalId: pendingApprovalIds[0],
    });
  }

  return outcomes;
}
