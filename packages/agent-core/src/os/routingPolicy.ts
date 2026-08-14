import type {
  OsIntent,
  RoutingDecisionRecord,
  ToolCall,
  ToolName,
  WorkflowKind,
} from '@enterprise-ai-os/shared';

/**
 * Deterministic routing policy — least-privilege tool families + request mode.
 * Application code enforces this; the LLM never authorizes tools.
 */

export type RequestMode = RoutingDecisionRecord['requestMode'];

export type IntentFamily =
  | 'meta'
  | 'jira'
  | 'slack_write'
  | 'slack_read'
  | 'notion'
  | 'launch'
  | 'incident'
  | 'reminder'
  | 'standup'
  | 'general'
  | 'read_only';

const FAMILY_ALLOWLIST: Record<IntentFamily, ToolName[]> = {
  meta: [],
  jira: ['jira'],
  slack_write: ['slack'],
  slack_read: ['slack'],
  notion: ['notion'],
  launch: ['slack', 'notion'],
  incident: ['slack', 'notion', 'jira'],
  reminder: ['slack'],
  standup: ['slack', 'jira', 'notion'],
  general: ['slack', 'jira', 'notion', 'gmail', 'salesforce'],
  read_only: [],
};

/** User asked to cancel / stop — never execute tools. */
export function isCancelRequest(q: string): boolean {
  const t = q.toLowerCase();
  return (
    /\b(cancel|never\s*mind|scratch\s+that|abort|stop)\b/.test(t) &&
    /\b(ticket|issue|request|previous|that|it|action|approval)\b/.test(t)
  );
}

/** User wants information / plan only — do not queue writes. */
export function isClarifyRequest(q: string): boolean {
  const t = q.toLowerCase();
  if (/\b(don'?t|do\s+not)\s+create\b/.test(t)) return true;
  if (/\btell\s+me\s+what\s+(information|info|details?|fields?)\b/.test(t)) return true;
  if (/\bwhat\s+(information|info|details?|fields?)\s+(do\s+you\s+need|are\s+required|needed)\b/.test(t))
    return true;
  // "ask me before submitting" is satisfied by Approvals — still allow plan+queue
  return false;
}

/** User wants a preview — plan only, no execution / no approval queue. */
export function isDryRunRequest(q: string): boolean {
  const t = q.toLowerCase();
  return (
    /\b(show|preview|draft)\s+me\s+what\s+you\s+would\b/.test(t) ||
    /\bdon'?t\s+execute\b/.test(t) ||
    /\bwithout\s+(creating|executing|submitting)\b/.test(t) ||
    /\bdry[- ]?run\b/.test(t)
  );
}

export function detectRequestMode(query: string): RequestMode {
  if (isCancelRequest(query)) return 'cancel';
  if (isClarifyRequest(query)) return 'clarify';
  if (isDryRunRequest(query)) return 'dry_run';
  if (/\?/.test(query) && !/\b(create|open|post|send|delete|update|launch)\b/i.test(query)) {
    return 'question';
  }
  return 'execute';
}

export function resolveIntentFamily(intent: OsIntent, query: string): IntentFamily {
  const mode = detectRequestMode(query);
  if (mode === 'cancel' || mode === 'clarify' || mode === 'dry_run') return 'meta';

  switch (intent.kind) {
    case 'launch_workflow':
      return 'launch';
    case 'incident_workflow':
      return 'incident';
    case 'reminder_workflow':
      return 'reminder';
    case 'standup_workflow':
      return 'standup';
    case 'workspace_intelligence':
      return 'slack_read';
    case 'notion_project':
      return 'notion';
    case 'read_only':
      return 'read_only';
    case 'simple_action':
    default:
      break;
  }

  const t = query.toLowerCase();
  if (/\bjira\b/.test(t) || (/\b(ticket|issue)\b/.test(t) && !/\b(slack|notion)\b/.test(t))) {
    return 'jira';
  }
  if (/\bnotion\b/.test(t)) return 'notion';
  if (/\bslack\b/.test(t) || /#[a-z0-9_-]+/i.test(query)) return 'slack_write';
  return 'general';
}

export function allowedToolsForFamily(family: IntentFamily): ToolName[] {
  return FAMILY_ALLOWLIST[family] ?? [];
}

export function filterToolCallsByFamily(
  calls: ToolCall[],
  family: IntentFamily
): { kept: ToolCall[]; stripped: RoutingDecisionRecord['strippedTools'] } {
  const allowed = new Set(allowedToolsForFamily(family));
  if (family === 'meta' || family === 'read_only') {
    return {
      kept: [],
      stripped: calls.map((c) => ({
        tool: c.tool,
        action: c.action,
        reason: family === 'meta' ? 'meta_request_no_execution' : 'read_only_no_tools',
      })),
    };
  }

  const kept: ToolCall[] = [];
  const stripped: RoutingDecisionRecord['strippedTools'] = [];
  for (const c of calls) {
    if (allowed.has(c.tool)) {
      // Jira family: never allow Slack war-room / incident / follow-up cross-fire
      if (
        family === 'jira' &&
        c.tool === 'slack' &&
        ['createWarRoom', 'createIncident', 'followUpPendingReplies'].includes(c.action)
      ) {
        stripped.push({ tool: c.tool, action: c.action, reason: 'jira_family_blocks_slack_workflow' });
        continue;
      }
      kept.push(c);
    } else {
      stripped.push({ tool: c.tool, action: c.action, reason: `tool_not_in_family:${family}` });
    }
  }
  return { kept, stripped };
}

export function missingFieldsForJiraCreate(input: Record<string, unknown>): string[] {
  const missing: string[] = [];
  const summary = String(input.summary ?? '').trim();
  const project = String(input.project ?? '').trim();
  if (!project) missing.push('project');
  if (!summary || summary.length < 3) missing.push('summary');
  // Soft signal: vendor tickets should name the vendor when the query implies vendor work
  return missing;
}

export function buildDecisionRecord(args: {
  query: string;
  intent: OsIntent;
  family: IntentFamily;
  mode: RequestMode;
  selected: ToolCall[];
  stripped: RoutingDecisionRecord['strippedTools'];
  pendingApprovalIds: string[];
  executedCount: number;
}): RoutingDecisionRecord {
  const missingFields: string[] = [];
  for (const c of args.selected) {
    if (c.tool === 'jira' && c.action === 'createIssue') {
      missingFields.push(...missingFieldsForJiraCreate(c.input));
    }
  }

  let validation: RoutingDecisionRecord['validation'] = 'passed';
  let execution: RoutingDecisionRecord['execution'] = 'not_started';

  if (args.mode === 'cancel') {
    validation = 'cancelled';
    execution = 'skipped';
  } else if (args.mode === 'clarify') {
    validation = 'needs_info';
    execution = 'skipped';
  } else if (args.mode === 'dry_run') {
    validation = 'dry_run';
    execution = 'skipped';
  } else if (missingFields.length > 0 && args.selected.some((c) => c.tool === 'jira' && c.action === 'createIssue')) {
    // Still allow queue when project may come from env default — only block if no tools
    validation = missingFields.includes('summary') ? 'needs_info' : 'passed';
  }

  if (args.pendingApprovalIds.length > 0) execution = 'queued_approval';
  else if (args.executedCount > 0) execution = 'executed';
  else if (args.mode !== 'execute') execution = 'skipped';

  return {
    requestMode: args.mode,
    intentKind: args.intent.kind,
    intentFamily: args.family,
    allowedTools: allowedToolsForFamily(args.family),
    selectedTools: args.selected.map((c) => ({ tool: c.tool, action: c.action })),
    strippedTools: args.stripped,
    missingFields: [...new Set(missingFields)],
    validation,
    execution,
    rationale: args.intent.rationale,
  };
}

export function clarifyReplyForJira(query: string): string {
  return (
    `I understand you want a **vendor-related Jira ticket**, but I’m not creating anything yet.\n\n` +
    `To create it reliably I need:\n` +
    `• **Project** key (e.g. \`OPS\`)\n` +
    `• **Summary** (short title)\n` +
    `• **Vendor name** (if this is vendor work)\n` +
    `• **Priority** (optional: Highest / High / Medium / Low)\n\n` +
    `Reply with those details (or say “create it in project X titled …”) and I’ll queue it for **Approvals**.`
  );
}

export function cancelReply(): string {
  return `Cancelled — I will not create or run any ticket/action from that request.`;
}

export function dryRunReplyForPlan(calls: ToolCall[]): string {
  if (calls.length === 0) {
    return `Dry run: I don’t have a concrete tool plan yet. Tell me the project, summary, and any vendor name.`;
  }
  const lines = calls.map((c) => {
    const bits = Object.entries(c.input)
      .slice(0, 6)
      .map(([k, v]) => `  - ${k}: ${typeof v === 'string' ? v.slice(0, 120) : JSON.stringify(v)}`)
      .join('\n');
    return `• **${c.tool}.${c.action}** (${c.riskLevel} risk, approval=${c.requiresApproval})\n${bits}`;
  });
  return (
    `Dry run — **nothing was executed or queued**:\n\n` +
    lines.join('\n\n') +
    `\n\nSay “create it” with any missing fields to queue this for Approvals.`
  );
}

export function intentKindAllowsWorkflow(kind: WorkflowKind): boolean {
  return [
    'launch_workflow',
    'incident_workflow',
    'standup_workflow',
    'reminder_workflow',
    'workspace_intelligence',
    'notion_project',
  ].includes(kind);
}
