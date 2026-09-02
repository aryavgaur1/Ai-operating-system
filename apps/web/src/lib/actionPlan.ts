import type { ApprovalRequest, ToolCallResult } from '@/lib/api';

export type ActionPlanStep = { id: string; label: string };

export type ActionPreview = {
  title: string;
  service: string;
  target: string;
  willChange: string[];
  steps: ActionPlanStep[];
  risk: string;
  riskLevel: 'low' | 'medium' | 'high';
};

const SERVICE_LABELS: Record<string, string> = {
  slack: 'Slack',
  jira: 'Jira',
  notion: 'Notion',
  gmail: 'Gmail',
};

const RISK_COPY: Record<string, string> = {
  low: 'Reversible action with minimal blast radius.',
  medium: 'Touches shared systems or external-facing records.',
  high: 'Externally visible or hard to reverse. Review carefully.',
};

export function serviceLabel(tool: string): string {
  return SERVICE_LABELS[tool] || tool;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function slackChannelLabel(raw: unknown, fallback?: unknown): string {
  const primary = String(raw || fallback || '').trim();
  if (!primary) return '#channel';
  if (primary.startsWith('#')) return primary;
  if (/^[CGD][A-Z0-9]+$/i.test(primary)) return primary;
  return `#${primary.replace(/^#/, '')}`;
}

export function humanActionTitle(
  tool: string,
  action: string,
  input: Record<string, unknown> = {}
): string {
  if (tool === 'jira' && action === 'createIssue') {
    return `Create Jira ticket: ${String(input.summary || input.title || 'Untitled')}`;
  }
  if (tool === 'jira' && action === 'addComment') {
    return `Comment on Jira ${String(input.issueKey || input.key || 'issue')}`;
  }
  if (tool === 'jira' && action === 'transitionIssue') {
    return `Move Jira ${String(input.issueKey || input.key || 'issue')}`;
  }
  if (tool === 'jira' && action === 'updateIssue') {
    return `Update Jira ${String(input.issueKey || input.key || 'issue')}`;
  }
  if (tool === 'slack' && (action === 'createWarRoom' || action === 'createChannel' || action === 'createIncident')) {
    const project = String(input.project || input.name || 'launch').trim();
    if (action === 'createIncident') return `Open incident channel: ${String(input.summary || project)}`;
    return `Create launch war room: ${project}`;
  }
  if (tool === 'slack' && (action === 'postMessage' || action === 'postMessageExternalChannel')) {
    return `Post to Slack ${slackChannelLabel(input.channel)}`;
  }
  if (tool === 'notion' && action.startsWith('create')) {
    return `Create Notion page: ${String(input.title || 'Untitled')}`;
  }
  if (tool === 'gmail' && action === 'sendEmail') {
    return `Email ${String(input.to || 'recipient')}: ${String(input.subject || 'draft')}`;
  }
  if (tool === 'gmail' && action === 'searchEmails') {
    return 'Search Gmail';
  }
  return `${tool}.${action}`;
}

export function timelineActionTitle(tool: string, action: string): string {
  if (tool === 'slack' && (action === 'createWarRoom' || action === 'createChannel')) {
    return 'Launch war room created';
  }
  if (tool === 'slack' && action === 'createIncident') return 'Incident channel created';
  if (tool === 'jira' && action === 'createIssue') return 'Jira ticket created';
  if (tool === 'notion' && action.startsWith('create')) return 'Notion page created';
  if (tool === 'gmail' && action === 'sendEmail') return 'Email sent';
  return humanActionTitle(tool, action);
}

export function plannedExecutionSteps(tool: string, action: string): ActionPlanStep[] {
  if (tool === 'slack' && (action === 'createWarRoom' || action === 'createChannel')) {
    return [
      { id: 'channel', label: 'Create channel' },
      { id: 'configure', label: 'Configure channel' },
      { id: 'invite', label: 'Invite requested members' },
    ];
  }
  if (tool === 'slack' && action === 'createIncident') {
    return [
      { id: 'channel', label: 'Create incident channel' },
      { id: 'configure', label: 'Attach runbook and topic' },
      { id: 'notify', label: 'Notify responders' },
    ];
  }
  if (tool === 'jira' && action === 'createIssue') {
    return [
      { id: 'create', label: 'Create Jira issue' },
      { id: 'verify', label: 'Verify issue in Jira' },
    ];
  }
  if (tool === 'notion') {
    return [
      { id: 'create', label: 'Create Notion page' },
      { id: 'verify', label: 'Verify page exists' },
    ];
  }
  if (tool === 'gmail' && action === 'sendEmail') {
    return [
      { id: 'draft', label: 'Prepare email' },
      { id: 'send', label: 'Send via Gmail' },
    ];
  }
  return [{ id: 'run', label: `Run ${serviceLabel(tool)} action` }];
}

export function buildActionPreview(
  tool: string,
  action: string,
  input: Record<string, unknown>,
  riskLevel: 'low' | 'medium' | 'high',
  workspaceName: string
): ActionPreview {
  const willChange: string[] = [];
  if (tool === 'jira' && action === 'createIssue') {
    willChange.push('Create 1 Jira issue');
    if (input.description) willChange.push('Set issue description');
  } else if (tool === 'slack' && (action === 'createWarRoom' || action === 'createChannel')) {
    willChange.push('Create a new Slack channel', 'Set topic and purpose', 'Invite team members');
  } else if (tool === 'slack' && action.startsWith('postMessage')) {
    willChange.push('Post 1 Slack message');
  } else if (tool === 'notion') {
    willChange.push(action === 'updatePage' ? 'Update 1 Notion page' : 'Create 1 Notion page');
  } else if (tool === 'gmail' && action === 'sendEmail') {
    willChange.push('Send 1 email via Gmail');
  } else {
    willChange.push(`Execute ${tool}.${action}`);
  }

  return {
    title: humanActionTitle(tool, action, input),
    service: serviceLabel(tool),
    target: workspaceName,
    willChange,
    steps: plannedExecutionSteps(tool, action),
    risk: RISK_COPY[riskLevel] || RISK_COPY.medium,
    riskLevel,
  };
}

export function buildActionPreviewFromApproval(a: ApprovalRequest, workspaceName: string): ActionPreview {
  return buildActionPreview(a.tool, a.action, a.input || {}, a.riskLevel, workspaceName);
}

function asOutput(result?: ToolCallResult | null): Record<string, unknown> {
  if (!result?.output || typeof result.output !== 'object') return {};
  return result.output as Record<string, unknown>;
}

/** Human-readable artifact from a verified execution (key, url, channel). */
export function executionArtifacts(
  approval: Pick<ApprovalRequest, 'tool' | 'action' | 'input'>,
  result?: ToolCallResult | null
): { primary?: string; url?: string; detail?: string; headline?: string } {
  const o = asOutput(result);
  const input = approval.input || {};

  if (approval.tool === 'jira') {
    const key = String(o.key || o.issueKey || input.issueKey || input.key || '').trim();
    const url = typeof o.url === 'string' ? o.url : undefined;
    if (approval.action === 'createIssue' && key) {
      return {
        primary: key,
        url,
        headline: 'Jira ticket created.',
        detail: url ? 'Open in Jira' : 'Issue created in Jira',
      };
    }
    if (key) return { primary: key, url, headline: 'Jira updated.', detail: url ? 'Open in Jira' : undefined };
  }

  if (approval.tool === 'notion') {
    const url = typeof o.url === 'string' ? o.url : undefined;
    const title = String(o.title || input.title || '').trim();
    const id = String(o.id || '').trim();
    if (url) {
      return {
        primary: title || 'Notion page',
        url,
        headline: 'Notion page created.',
        detail: 'Open in Notion',
      };
    }
    if (id) return { primary: title || id, headline: 'Notion page created.', detail: `Page id ${id.slice(0, 8)}…` };
  }

  if (approval.tool === 'slack') {
    const channelObj = asRecord(o.channel);
    const channelName = slackChannelLabel(
      o.channelName || o.name || channelObj.name,
      input.channel || channelObj.name || input.name
    );
    const channelId = String(o.id || channelObj.id || '').trim();
    const ts = o.ts ? String(o.ts) : undefined;
    let url = typeof o.url === 'string' ? o.url : typeof channelObj.url === 'string' ? channelObj.url : undefined;
    if (!url && channelId) url = `https://slack.com/app_redirect?channel=${channelId}`;
    const headline =
      approval.action === 'createWarRoom' || approval.action === 'createChannel'
        ? 'Launch war room created.'
        : approval.action === 'createIncident'
          ? 'Incident channel created.'
          : 'Slack action completed.';
    return {
      primary: channelName,
      url,
      headline,
      detail: url ? 'Open in Slack' : ts ? `Posted · ts ${ts}` : channelId ? `Channel ${channelId}` : 'Message posted',
    };
  }

  if (approval.tool === 'gmail' && approval.action === 'sendEmail') {
    const to = String(o.to || input.to || '').trim();
    const subject = String(o.subject || input.subject || '').trim();
    const url = typeof o.url === 'string' ? o.url : undefined;
    return {
      primary: to || 'Email sent',
      url,
      headline: 'Email sent.',
      detail: subject || (url ? 'Open in Gmail' : undefined),
    };
  }

  const key = o.key || o.id || o.ts;
  const url = typeof o.url === 'string' ? o.url : undefined;
  if (key || url) {
    return {
      primary: key ? String(key) : undefined,
      url,
      headline: 'Action completed.',
      detail: url ? 'Open result' : undefined,
    };
  }
  return { headline: 'Action completed.' };
}

export function executionArtifactsFromCall(
  tool: string,
  action: string,
  result?: ToolCallResult | null,
  input: Record<string, unknown> = {}
): ReturnType<typeof executionArtifacts> {
  return executionArtifacts({ tool, action, input }, result);
}
