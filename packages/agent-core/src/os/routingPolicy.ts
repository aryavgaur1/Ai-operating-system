import type {
  OsIntent,
  RoutingDecisionRecord,
  ToolCall,
  ToolName,
  WorkflowKind,
} from '@enterprise-ai-os/shared';
import {
  isHighConsequence,
  policyAllowsAutoRun,
  DEFAULT_APPROVAL_POLICY,
} from '@enterprise-ai-os/shared';
import {
  detectOsIntent,
  isExplicitJiraCreate,
  isExplicitJiraDelete,
  isExplicitNotionCommand,
  isExplicitSlackCommand,
  isSlackReadQuestion,
  routingQuery,
} from './intentDetector';
import {
  buildCapabilityScope,
  filterCallsByCapabilityScope,
} from './capabilityRegistry';
import {
  buildGmailSearchQuery,
  isGmailDestinationQuery,
  isGmailSendQuery,
} from './gmailQuery';
import {
  isGmailSoftReadQuery,
  isJiraReadQuery,
  isSlackSoftReadQuery,
  jiraSearchFlags,
  isWorkPulseQuery,
  workPulseRouteHint,
  isNotionDocQuery,
  isCrossToolSlackJiraQuery,
  impliesLiveWorkspaceData,
  impliesWorkspaceExecution,
  isActionMutationQuery,
} from './workAssistantIntent';

/**
 * Authoritative routing — ONE decision before planner/workflow/executor.
 * Application code owns tool selection. Keyword rules may only fill inputs
 * inside the locked tool family; they cannot override the decision.
 */

export type RequestMode = RoutingDecisionRecord['requestMode'];

export type IntentFamily =
  | 'meta'
  | 'jira'
  | 'slack_write'
  | 'slack_read'
  | 'notion'
  | 'gmail_read'
  | 'gmail_write'
  | 'launch'
  | 'incident'
  | 'reminder'
  | 'standup'
  | 'general'
  | 'read_only';

export type RouteAction =
  | 'create'
  | 'delete'
  | 'update'
  | 'search'
  | 'post'
  | 'launch'
  | 'incident'
  | 'remind'
  | 'read'
  | 'unknown';

export interface AuthoritativeRoute {
  mode: RequestMode;
  family: IntentFamily;
  osIntent: OsIntent;
  /** Primary system — null when ambiguous / meta */
  lockedTool: ToolName | null;
  /** Concrete connector action when locked with high confidence */
  lockedAction: string | null;
  routeAction: RouteAction;
  entities: Record<string, string>;
  confidence: number;
  ambiguous: boolean;
  /** Multi-step OS workflows allowed only when true */
  allowWorkflow: boolean;
  clarifyMessage?: string;
  rationale: string;
}

const FAMILY_ALLOWLIST: Record<IntentFamily, ToolName[]> = {
  meta: [],
  jira: ['jira'],
  slack_write: ['slack'],
  slack_read: ['slack'],
  notion: ['notion'],
  gmail_read: ['gmail'],
  gmail_write: ['gmail'],
  launch: ['slack', 'notion'],
  incident: ['slack', 'notion', 'jira'],
  reminder: ['slack'],
  standup: ['slack', 'jira', 'notion'],
  // general is intentionally empty — ambiguous requests must clarify, not race tools
  general: [],
  read_only: [],
};

export function isCancelRequest(q: string): boolean {
  const t = q.toLowerCase();
  return (
    /\b(cancel|never\s*mind|scratch\s+that|abort|stop)\b/.test(t) &&
    /\b(ticket|issue|request|previous|that|it|action|approval)\b/.test(t)
  );
}

export function isClarifyRequest(q: string): boolean {
  const t = q.toLowerCase();
  if (/\b(don'?t|do\s+not)\s+create\b/.test(t)) return true;
  if (/\btell\s+me\s+what\s+(information|info|details?|fields?)\b/.test(t)) return true;
  if (/\bwhat\s+(information|info|details?|fields?)\s+(do\s+you\s+need|are\s+required|needed)\b/.test(t))
    return true;
  return false;
}

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
  // Gmail read/search questions must execute the connector — not stall in clarify mode.
  if ((isGmailDestinationQuery(query) || isGmailSoftReadQuery(query)) && !isGmailSendQuery(query)) {
    return 'execute';
  }
  // Jira pending/overdue reads are actionable — not clarify.
  if (isJiraReadQuery(query)) {
    return 'execute';
  }
  if (isSlackSoftReadQuery(query)) {
    return 'execute';
  }
  if (isWorkPulseQuery(query)) {
    return 'execute';
  }
  if (isNotionDocQuery(query)) {
    return 'execute';
  }
  if (isCrossToolSlackJiraQuery(query)) {
    return 'execute';
  }
  if (isActionMutationQuery(query)) {
    return 'execute';
  }
  if (/\?/.test(query) && !/\b(create|open|post|send|delete|update|launch)\b/i.test(query)) {
    return 'question';
  }
  return 'execute';
}

function extractEntities(query: string): Record<string, string> {
  const entities: Record<string, string> = {};
  const issueKey = query.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1];
  if (issueKey) entities.issueKey = issueKey;

  const project =
    query.match(/\b(?:in|for)\s+project\s+([A-Z][A-Z0-9_]{1,10})\b/i)?.[1] ||
    query.match(/\bproject\s+([A-Z][A-Z0-9_]{1,10})\b/i)?.[1];
  if (project) entities.project = project.toUpperCase();

  const priority = query.match(/\bpriority\s+(Highest|High|Medium|Low|Lowest)\b/i)?.[1];
  if (priority) entities.priority = priority;

  const vendor =
    query.match(/\bvendor\s+([A-Za-z0-9][\w .-]{1,40})/i)?.[1]?.trim() ||
    (/\bvendor\b/i.test(query) ? 'vendor' : undefined);
  if (vendor) entities.vendor = vendor;

  const titled =
    query.match(/(?:titled|called|named)\s+["']?([^"'\n.]+)["']?/i)?.[1]?.trim() ||
    query.match(/create (?:a )?(?:jira )?(?:ticket|issue|task|risk)(?: for| about| to)?\s+(.+)/i)?.[1]?.trim();
  if (titled) entities.summary = titled.slice(0, 100);

  const channel = query.match(/#([a-z0-9_-]+)/i)?.[1];
  if (channel) entities.channel = channel;

  return entities;
}

function detectRouteAction(query: string): RouteAction {
  const t = query.toLowerCase();
  if (/\b(delete|remove)\b/.test(t) && /\b(ticket|issue|page)\b/.test(t)) return 'delete';
  if (/\b(war\s*room|launch\s+war|launch\s+room)\b/.test(t)) return 'launch';
  if (/\b(production\s+)?incident\b/.test(t) || /\b(outage|sev[-\s]?\d)\b/.test(t)) return 'incident';
  if (/\b(follow[- ]?up|nudge|remind)\b/.test(t) && /\b(pending|approvals?|slack)\b/.test(t)) return 'remind';
  if (/\b(create|open|file|log|track|new)\b/.test(t)) return 'create';
  if (/\b(update|transition|move|assign|comment)\b/.test(t)) return 'update';
  if (/\b(search|find|list|show|get|what)\b/.test(t)) return 'search';
  if (/\b(post|send|message)\b/.test(t)) return 'post';
  if (isSlackReadQuestion(query)) return 'read';
  return 'unknown';
}

/**
 * Destination systems (where the action runs) — NOT referenced nouns in content.
 * "Post a Slack update about the Notion integration" → Slack only.
 * "Create a Notion page documenting our Jira integration" → Notion only.
 */
function destinations(query: string): { jira: boolean; slack: boolean; notion: boolean; gmail: boolean } {
  const t = query.toLowerCase();

  const slack =
    isExplicitSlackCommand(query) ||
    isSlackReadQuestion(query) ||
    isSlackSoftReadQuery(query) ||
    /\b(war\s*room|launch\s+war)\b/.test(t);

  // Notion destination — explicit command or documentation search
  const notion = !slack && (isExplicitNotionCommand(query) || isNotionDocQuery(query));

  const jira =
    !slack &&
    !notion &&
    (isExplicitJiraCreate(query) ||
      isExplicitJiraDelete(query) ||
      isJiraReadQuery(query) ||
      (isWorkPulseQuery(query) && workPulseRouteHint(query) === 'jira') ||
      (/\bjira\b/.test(t) &&
        /\b(create|open|file|log|track|update|delete|transition|assign|comment|ticket|issue|search|find|show|list|pending|overdue)\b/.test(
          t
        )) ||
      (/\b(ticket|issue)\b/.test(t) && !/\b(slack|notion|channel|war\s*room|page|doc|message)\b/.test(t)));

  // Gmail destination — explicit email/gmail language not claimed by other systems
  const gmail =
    !slack &&
    !notion &&
    !jira &&
    (isGmailDestinationQuery(query) ||
      isGmailSoftReadQuery(query) ||
      (isWorkPulseQuery(query) && workPulseRouteHint(query) === 'gmail_read'));

  return { jira, slack, notion, gmail };
}

function ambiguousClarifyMessage(query: string, dest: ReturnType<typeof destinations>): string {
  const systems = [
    dest.jira && 'Jira',
    dest.slack && 'Slack',
    dest.notion && 'Notion',
  ].filter(Boolean);
  if (systems.length > 1) {
    return (
      `Your request mentions **${systems.join(' + ')}**. I’m not executing anything yet.\n\n` +
      `Which system should I act on first?\n` +
      `• Jira ticket create/update/delete\n` +
      `• Slack post / channel / war room\n` +
      `• Notion page\n\n` +
      `Reply with one clear action (example: “Create a Jira ticket in project OPS titled Vendor onboarding”).`
    );
  }
  return (
    `I’m not sure what action to take, so I won’t execute anything.\n\n` +
    `Please clarify:\n` +
    `• System: Jira / Slack / Notion\n` +
    `• Action: create / update / delete / post / search\n` +
    `• Key details (project, summary, channel, issue key)\n\n` +
    `Example: “Create a vendor Jira ticket in project OPS titled Acme contract follow-up”.`
  );
}

/**
 * Single authoritative routing decision for the whole turn.
 * Call this ONCE; planner/workflow/executor must obey it.
 */
export function resolveAuthoritativeRoute(query: string): AuthoritativeRoute {
  // History/memory appended after planner marker must not change the live route
  query = routingQuery(query);
  const mode = detectRequestMode(query);
  const entities = extractEntities(query);
  const routeAction = detectRouteAction(query);
  const dest = destinations(query);
  const osIntent = detectOsIntent(query);

  // --- Meta modes: never tools ---
  if (mode === 'cancel') {
    return {
      mode,
      family: 'meta',
      osIntent,
      lockedTool: null,
      lockedAction: null,
      routeAction,
      entities,
      confidence: 1,
      ambiguous: false,
      allowWorkflow: false,
      clarifyMessage: undefined,
      rationale: 'Cancel request — no tools',
    };
  }
  if (mode === 'clarify' || mode === 'question') {
    // Gmail inbox questions are actionable reads — lock searchEmails instead of clarifying.
    if (dest.gmail && !isGmailSendQuery(query)) {
      return {
        mode: 'execute',
        family: 'gmail_read',
        osIntent: {
          ...osIntent,
          kind: 'simple_action',
          confidence: 0.95,
          rationale: 'Gmail read/search question — execute searchEmails',
          legacyIntent: 'action',
        },
        lockedTool: 'gmail',
        lockedAction: 'searchEmails',
        routeAction: 'search',
        entities,
        confidence: 0.95,
        ambiguous: false,
        allowWorkflow: false,
        rationale: 'Locked gmail.searchEmails (question treated as read)',
      };
    }
    // Jira pending/overdue questions → searchIssues
    if (dest.jira && isJiraReadQuery(query)) {
      return {
        mode: 'execute',
        family: 'jira',
        osIntent: {
          ...osIntent,
          kind: 'simple_action',
          confidence: 0.94,
          rationale: 'Jira read/search question — execute searchIssues',
          legacyIntent: 'action',
        },
        lockedTool: 'jira',
        lockedAction: 'searchIssues',
        routeAction: 'search',
        entities,
        confidence: 0.94,
        ambiguous: false,
        allowWorkflow: false,
        rationale: 'Locked jira.searchIssues (question treated as read)',
      };
    }
    if (dest.slack && (isSlackReadQuestion(query) || isSlackSoftReadQuery(query))) {
      return {
        mode: 'execute',
        family: 'slack_read',
        osIntent: {
          ...osIntent,
          kind: 'workspace_intelligence',
          confidence: 0.93,
          rationale: 'Slack team/conversation question — search history',
          legacyIntent: 'read',
        },
        lockedTool: 'slack',
        lockedAction: null,
        routeAction: 'read',
        entities,
        confidence: 0.93,
        ambiguous: false,
        allowWorkflow: true,
        rationale: 'Slack soft-read question',
      };
    }
    if (isWorkPulseQuery(query)) {
      const hint = workPulseRouteHint(query);
      if (hint === 'gmail_read') {
        return {
          mode: 'execute',
          family: 'gmail_read',
          osIntent: { ...osIntent, kind: 'simple_action', confidence: 0.92, rationale: 'Work pulse → Gmail important', legacyIntent: 'action' },
          lockedTool: 'gmail',
          lockedAction: 'searchEmails',
          routeAction: 'search',
          entities,
          confidence: 0.92,
          ambiguous: false,
          allowWorkflow: false,
          rationale: 'Work pulse locked to gmail.searchEmails',
        };
      }
      if (hint === 'jira') {
        return {
          mode: 'execute',
          family: 'jira',
          osIntent: { ...osIntent, kind: 'simple_action', confidence: 0.92, rationale: 'Work pulse → Jira tasks', legacyIntent: 'action' },
          lockedTool: 'jira',
          lockedAction: 'searchIssues',
          routeAction: 'search',
          entities,
          confidence: 0.92,
          ambiguous: false,
          allowWorkflow: false,
          rationale: 'Work pulse locked to jira.searchIssues',
        };
      }
      return {
        mode: 'execute',
        family: 'slack_read',
        osIntent: { ...osIntent, kind: 'workspace_intelligence', confidence: 0.91, rationale: 'Work pulse → Slack', legacyIntent: 'read' },
        lockedTool: 'slack',
        lockedAction: null,
        routeAction: 'read',
        entities,
        confidence: 0.91,
        ambiguous: false,
        allowWorkflow: true,
        rationale: 'Work pulse locked to Slack intelligence',
      };
    }
    if (isNotionDocQuery(query)) {
      return {
        mode: 'execute',
        family: 'notion',
        osIntent: { ...osIntent, kind: 'simple_action', confidence: 0.93, rationale: 'Documentation search → Notion', legacyIntent: 'action' },
        lockedTool: 'notion',
        lockedAction: 'searchPages',
        routeAction: 'search',
        entities,
        confidence: 0.93,
        ambiguous: false,
        allowWorkflow: false,
        rationale: 'Locked notion.searchPages',
      };
    }
    return {
      mode: mode === 'question' ? 'clarify' : mode,
      family: 'meta',
      osIntent,
      lockedTool: dest.jira ? 'jira' : dest.slack ? 'slack' : dest.notion ? 'notion' : dest.gmail ? 'gmail' : null,
      lockedAction: null,
      routeAction,
      entities,
      confidence: 0.95,
      ambiguous: false,
      allowWorkflow: false,
      clarifyMessage: dest.jira || /\b(ticket|vendor)\b/i.test(query) ? clarifyReplyForJira(query) : ambiguousClarifyMessage(query, dest),
      rationale: 'Clarify / question — no execution',
    };
  }
  if (mode === 'dry_run') {
    // Dry-run may lock a preview tool but never execute
    let lockedTool: ToolName | null = null;
    let lockedAction: string | null = null;
    let family: IntentFamily = 'meta';
    if (isExplicitJiraCreate(query) || (dest.jira && routeAction === 'create')) {
      lockedTool = 'jira';
      lockedAction = 'createIssue';
      family = 'jira';
    }
    return {
      mode,
      family,
      osIntent,
      lockedTool,
      lockedAction,
      routeAction,
      entities,
      confidence: 0.9,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Dry-run — preview only',
    };
  }

  // --- Hard locks (highest priority) — beat all workflows ---
  // Cross-tool: search Slack for context, then prepare Jira ticket (approval-gated create)
  if (isCrossToolSlackJiraQuery(query)) {
    return {
      mode: 'execute',
      family: 'incident',
      osIntent: {
        ...osIntent,
        kind: 'workspace_intelligence',
        confidence: 0.94,
        rationale: 'Cross-tool Slack search → Jira create',
        legacyIntent: 'action',
      },
      lockedTool: null,
      lockedAction: null,
      routeAction: 'create',
      entities,
      confidence: 0.94,
      ambiguous: false,
      allowWorkflow: true,
      rationale: 'Cross-tool Slack→Jira workflow',
    };
  }

  if (isExplicitJiraDelete(query)) {
    return {
      mode: 'execute',
      family: 'jira',
      osIntent: {
        ...osIntent,
        kind: 'simple_action',
        confidence: 0.99,
        rationale: 'Explicit Jira delete — deleteIssue only',
        legacyIntent: 'action',
      },
      lockedTool: 'jira',
      lockedAction: 'deleteIssue',
      routeAction: 'delete',
      entities,
      confidence: 0.99,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Locked jira.deleteIssue',
    };
  }

  if (isExplicitJiraCreate(query)) {
    return {
      mode: 'execute',
      family: 'jira',
      osIntent: {
        ...osIntent,
        kind: 'simple_action',
        confidence: 0.99,
        rationale: 'Explicit Jira create — createIssue + Approvals only',
        legacyIntent: 'action',
      },
      lockedTool: 'jira',
      lockedAction: 'createIssue',
      routeAction: 'create',
      entities,
      confidence: 0.99,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Locked jira.createIssue — Slack/Notion workflows forbidden',
    };
  }

  // Cross-system collision without a clear primary → clarify
  const destCount = [dest.jira, dest.slack, dest.notion, dest.gmail].filter(Boolean).length;
  if (destCount >= 2 && osIntent.kind === 'simple_action') {
    // Exception: explicit Slack command that also mentions a Notion URL is Slack-only (handled in intent detector)
    if (!(isExplicitSlackCommand(query) && !isExplicitJiraCreate(query) && !/\bjira\b/i.test(query))) {
      if (dest.jira && (dest.slack || dest.notion) && /\b(ticket|issue)\b/i.test(query)) {
        // Ticket language + jira wins over slack noise unless war-room explicit
        if (!/\b(war\s*room|launch\s+war)\b/i.test(query)) {
          return {
            mode: 'execute',
            family: 'jira',
            osIntent: { ...osIntent, kind: 'simple_action', legacyIntent: 'action', rationale: 'Jira ticket language wins over secondary mentions' },
            lockedTool: 'jira',
            lockedAction: routeAction === 'delete' ? 'deleteIssue' : 'createIssue',
            routeAction: routeAction === 'delete' ? 'delete' : 'create',
            entities,
            confidence: 0.92,
            ambiguous: false,
            allowWorkflow: false,
            rationale: 'Jira primary despite secondary tool mentions',
          };
        }
      }
    }
  }

  // Explicit Slack/Notion CRUD beats workflow keyword collisions
  // e.g. "Post to #ops: standup summary ready" must NOT become dailyDigest
  if (isExplicitSlackCommand(query)) {
    const postish = /\b(post|send|message|invite|create\s+channel|bookmark|pin)\b/i.test(query);
    if (postish || !['standup_workflow', 'reminder_workflow', 'launch_workflow', 'incident_workflow'].includes(osIntent.kind)) {
      return {
        mode: 'execute',
        family: 'slack_write',
        osIntent: {
          ...osIntent,
          kind: 'simple_action',
          confidence: 0.97,
          rationale: 'Explicit Slack write command — single-tool Slack only',
          legacyIntent: 'action',
        },
        lockedTool: 'slack',
        lockedAction: null,
        routeAction: /\b(post|send)\b/i.test(query) ? 'post' : routeAction,
        entities,
        confidence: 0.97,
        ambiguous: false,
        allowWorkflow: false,
        rationale: 'Explicit Slack command beats workflow keyword collision',
      };
    }
  }
  if (isExplicitNotionCommand(query) && osIntent.kind !== 'notion_project') {
    return {
      mode: 'execute',
      family: 'notion',
      osIntent: { ...osIntent, kind: 'simple_action', legacyIntent: 'action', rationale: 'Explicit Notion command' },
      lockedTool: 'notion',
      lockedAction: null,
      routeAction,
      entities,
      confidence: 0.96,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Explicit Notion command',
    };
  }

  // Gmail — email read/search/send commands (beats workspace_intelligence / Slack steal)
  if (dest.gmail) {
    const isSend = isGmailSendQuery(query);
    console.info('[route/gmail]', {
      intent: isSend ? 'gmail_write' : 'gmail_read',
      tool: 'gmail',
      action: isSend ? 'sendEmail' : 'searchEmails',
      queryPreview: query.slice(0, 120),
    });
    return {
      mode: 'execute',
      family: isSend ? 'gmail_write' : 'gmail_read',
      osIntent: {
        ...osIntent,
        kind: 'simple_action',
        confidence: 0.95,
        rationale: isSend ? 'Explicit Gmail send command' : 'Explicit Gmail read/search command',
        legacyIntent: 'action',
      },
      lockedTool: 'gmail',
      lockedAction: isSend ? 'sendEmail' : 'searchEmails',
      routeAction: isSend ? 'post' : 'search',
      entities,
      confidence: 0.95,
      ambiguous: false,
      allowWorkflow: false,
      rationale: isSend ? 'Locked gmail.sendEmail' : 'Locked gmail.searchEmails',
    };
  }

  // Jira pending / overdue / finish-today reads
  if (dest.jira && isJiraReadQuery(query) && routeAction !== 'create' && routeAction !== 'delete') {
    return {
      mode: 'execute',
      family: 'jira',
      osIntent: {
        ...osIntent,
        kind: 'simple_action',
        confidence: 0.94,
        rationale: 'Jira read/search — searchIssues',
        legacyIntent: 'action',
      },
      lockedTool: 'jira',
      lockedAction: 'searchIssues',
      routeAction: 'search',
      entities,
      confidence: 0.94,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Locked jira.searchIssues',
    };
  }

  // Work-priority questions → real connector (not generic LLM)
  if (isWorkPulseQuery(query)) {
    const hint = workPulseRouteHint(query);
    if (hint === 'gmail_read') {
      return {
        mode: 'execute',
        family: 'gmail_read',
        osIntent: { ...osIntent, kind: 'simple_action', confidence: 0.92, rationale: 'Work pulse → Gmail', legacyIntent: 'action' },
        lockedTool: 'gmail',
        lockedAction: 'searchEmails',
        routeAction: 'search',
        entities,
        confidence: 0.92,
        ambiguous: false,
        allowWorkflow: false,
        rationale: 'Work pulse → gmail.searchEmails',
      };
    }
    if (hint === 'jira') {
      return {
        mode: 'execute',
        family: 'jira',
        osIntent: { ...osIntent, kind: 'simple_action', confidence: 0.92, rationale: 'Work pulse → Jira', legacyIntent: 'action' },
        lockedTool: 'jira',
        lockedAction: 'searchIssues',
        routeAction: 'search',
        entities,
        confidence: 0.92,
        ambiguous: false,
        allowWorkflow: false,
        rationale: 'Work pulse → jira.searchIssues',
      };
    }
    return {
      mode: 'execute',
      family: 'slack_read',
      osIntent: { ...osIntent, kind: 'workspace_intelligence', confidence: 0.91, rationale: 'Work pulse → Slack', legacyIntent: 'read' },
      lockedTool: 'slack',
      lockedAction: null,
      routeAction: 'read',
      entities,
      confidence: 0.91,
      ambiguous: false,
      allowWorkflow: true,
      rationale: 'Work pulse → Slack intelligence',
    };
  }

  if (isNotionDocQuery(query)) {
    return {
      mode: 'execute',
      family: 'notion',
      osIntent: { ...osIntent, kind: 'simple_action', confidence: 0.93, rationale: 'Documentation search', legacyIntent: 'action' },
      lockedTool: 'notion',
      lockedAction: 'searchPages',
      routeAction: 'search',
      entities,
      confidence: 0.93,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Locked notion.searchPages',
    };
  }

  // Workflow kinds from OS intent (launch/incident/…) — only when not Jira-locked
  switch (osIntent.kind) {
    case 'launch_workflow':
      return {
        mode: 'execute',
        family: 'launch',
        osIntent,
        lockedTool: 'slack',
        lockedAction: 'createWarRoom',
        routeAction: 'launch',
        entities: { ...entities, ...osIntent.entities },
        confidence: osIntent.confidence,
        ambiguous: false,
        allowWorkflow: true,
        rationale: osIntent.rationale,
      };
    case 'incident_workflow':
      return {
        mode: 'execute',
        family: 'incident',
        osIntent,
        lockedTool: 'slack',
        lockedAction: 'createIncident',
        routeAction: 'incident',
        entities: { ...entities, ...osIntent.entities },
        confidence: osIntent.confidence,
        ambiguous: false,
        allowWorkflow: true,
        rationale: osIntent.rationale,
      };
    case 'reminder_workflow':
      return {
        mode: 'execute',
        family: 'reminder',
        osIntent,
        lockedTool: 'slack',
        lockedAction: 'followUpPendingReplies',
        routeAction: 'remind',
        entities,
        confidence: osIntent.confidence,
        ambiguous: false,
        allowWorkflow: true,
        rationale: osIntent.rationale,
      };
    case 'standup_workflow':
      return {
        mode: 'execute',
        family: 'standup',
        osIntent,
        lockedTool: 'slack',
        lockedAction: 'dailyDigest',
        routeAction: 'read',
        entities,
        confidence: osIntent.confidence,
        ambiguous: false,
        allowWorkflow: true,
        rationale: osIntent.rationale,
      };
    case 'workspace_intelligence':
      return {
        mode: 'execute',
        family: 'slack_read',
        osIntent,
        lockedTool: 'slack',
        lockedAction: null,
        routeAction: 'read',
        entities: { ...entities, ...osIntent.entities },
        confidence: osIntent.confidence,
        ambiguous: false,
        allowWorkflow: true,
        rationale: osIntent.rationale,
      };
    case 'notion_project':
      return {
        mode: 'execute',
        family: 'notion',
        osIntent,
        lockedTool: 'notion',
        lockedAction: null,
        routeAction: routeAction === 'create' ? 'create' : routeAction,
        entities: { ...entities, ...osIntent.entities },
        confidence: osIntent.confidence,
        ambiguous: false,
        allowWorkflow: false,
        rationale: osIntent.rationale,
      };
    case 'read_only':
      return {
        mode: 'clarify',
        family: 'read_only',
        osIntent,
        lockedTool: null,
        lockedAction: null,
        routeAction: 'unknown',
        entities,
        confidence: osIntent.confidence,
        ambiguous: true,
        allowWorkflow: false,
        clarifyMessage: ambiguousClarifyMessage(query, dest),
        rationale: 'No operational verbs — ask instead of guessing tools',
      };
    default:
      break;
  }

  // Explicit Slack / Notion simple actions
  if (isExplicitSlackCommand(query)) {
    return {
      mode: 'execute',
      family: 'slack_write',
      osIntent,
      lockedTool: 'slack',
      lockedAction: null,
      routeAction,
      entities,
      confidence: 0.96,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Explicit Slack command',
    };
  }
  if (isExplicitNotionCommand(query)) {
    return {
      mode: 'execute',
      family: 'notion',
      osIntent,
      lockedTool: 'notion',
      lockedAction: null,
      routeAction,
      entities,
      confidence: 0.96,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Explicit Notion command',
    };
  }

  // Ticket/issue language without competing destination → Jira
  if (dest.jira && (routeAction === 'create' || routeAction === 'delete' || routeAction === 'update')) {
    return {
      mode: 'execute',
      family: 'jira',
      osIntent,
      lockedTool: 'jira',
      lockedAction:
        routeAction === 'delete' ? 'deleteIssue' : routeAction === 'update' ? null : 'createIssue',
      routeAction,
      entities,
      confidence: 0.9,
      ambiguous: false,
      allowWorkflow: false,
      rationale: 'Jira destination + write verb',
    };
  }

  // Ambiguous: don't execute
  return {
    mode: 'clarify',
    family: 'general',
    osIntent,
    lockedTool: null,
    lockedAction: null,
    routeAction,
    entities,
    confidence: 0.4,
    ambiguous: true,
    allowWorkflow: false,
    clarifyMessage: ambiguousClarifyMessage(query, dest),
    rationale: 'Ambiguous request — refuse to guess tools',
  };
}

/** @deprecated Prefer resolveAuthoritativeRoute — kept for scripts */
export function resolveIntentFamily(intent: OsIntent, query: string): IntentFamily {
  return resolveAuthoritativeRoute(query).family;
}

export function allowedToolsForFamily(family: IntentFamily): ToolName[] {
  return FAMILY_ALLOWLIST[family] ?? [];
}

export function filterToolCallsByFamily(
  calls: ToolCall[],
  family: IntentFamily,
  route?: AuthoritativeRoute
): { kept: ToolCall[]; stripped: RoutingDecisionRecord['strippedTools'] } {
  if (route?.ambiguous || route?.mode === 'cancel' || route?.mode === 'clarify') {
    return {
      kept: [],
      stripped: calls.map((c) => ({
        tool: c.tool,
        action: c.action,
        reason: 'authoritative_route_blocks_execution',
      })),
    };
  }

  // Locked tool+action: keep only exact match (or same tool if action unlocked)
  if (route?.lockedTool) {
    const kept: ToolCall[] = [];
    const stripped: RoutingDecisionRecord['strippedTools'] = [];
    for (const c of calls) {
      if (c.tool !== route.lockedTool) {
        stripped.push({ tool: c.tool, action: c.action, reason: 'locked_tool_mismatch' });
        continue;
      }
      if (route.lockedAction && c.action !== route.lockedAction) {
        stripped.push({ tool: c.tool, action: c.action, reason: 'locked_action_mismatch' });
        continue;
      }
      kept.push(c);
    }
    // Action-level capability check on whatever survived the lock
    const scope = buildCapabilityScope(route);
    const byCap = filterCallsByCapabilityScope(kept, scope);
    return {
      kept: byCap.kept,
      stripped: [
        ...stripped,
        ...byCap.stripped.map((s) => ({
          tool: s.tool,
          action: s.action,
          reason: s.reason === 'CAPABILITY_NOT_ALLOWED' ? `capability_not_in_scope:${family}` : s.reason,
        })),
      ],
    };
  }

  if (family === 'meta' || family === 'read_only' || family === 'general') {
    return {
      kept: [],
      stripped: calls.map((c) => ({
        tool: c.tool,
        action: c.action,
        reason: `family_${family}_no_tools`,
      })),
    };
  }

  // Action-level capability scope (application-owned) — not LLM / keyword trust
  const scope = buildCapabilityScope(route ?? { family, lockedTool: null, lockedAction: null, ambiguous: false, mode: 'execute' });
  const byCap = filterCallsByCapabilityScope(calls, scope);
  return {
    kept: byCap.kept,
    stripped: byCap.stripped.map((s) => ({
      tool: s.tool,
      action: s.action,
      reason: s.reason === 'CAPABILITY_NOT_ALLOWED' ? `capability_not_in_scope:${family}` : s.reason,
    })),
  };
}

/** Build the single locked tool call from the authoritative route (when possible). */
export function toolCallFromRoute(route: AuthoritativeRoute, query: string): ToolCall | null {
  if (!route.lockedTool || !route.lockedAction) return null;
  if (route.mode !== 'execute' && route.mode !== 'dry_run') return null;

  const requiresApproval =
    isHighConsequence(route.lockedTool, route.lockedAction) &&
    !policyAllowsAutoRun(DEFAULT_APPROVAL_POLICY, route.lockedTool, route.lockedAction);

  if (route.lockedTool === 'jira' && route.lockedAction === 'createIssue') {
    const summary =
      route.entities.summary ||
      query
        .replace(/\bjira\b/gi, '')
        .replace(/\b(create|a|an|the|ticket|issue|task|to|track|vendor)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) ||
      'New ticket';
    const project = (route.entities.project || process.env.JIRA_DEFAULT_PROJECT || '').trim().toUpperCase();
    return {
      tool: 'jira',
      action: 'createIssue',
      input: {
        ...(project ? { project } : {}),
        summary: summary.slice(0, 255),
        description: query,
        issueType: 'Task',
        ...(route.entities.priority ? { priority: route.entities.priority } : {}),
      },
      riskLevel: requiresApproval ? 'high' : 'low',
      requiresApproval,
    };
  }

  if (route.lockedTool === 'jira' && route.lockedAction === 'deleteIssue') {
    return {
      tool: 'jira',
      action: 'deleteIssue',
      input: { key: route.entities.issueKey || '' },
      riskLevel: requiresApproval ? 'high' : 'low',
      requiresApproval,
    };
  }

  if (route.lockedTool === 'gmail' && route.lockedAction === 'searchEmails') {
    const gmailQ = buildGmailSearchQuery(query);
    console.info('[gmail] search_query', {
      nlPreview: query.slice(0, 120),
      gmailQuery: gmailQ,
    });
    return {
      tool: 'gmail',
      action: 'searchEmails',
      input: {
        query: gmailQ,
        maxResults: /\b(priority|important|top|urgent)\b/i.test(query) ? 8 : 10,
      },
      riskLevel: 'low',
      requiresApproval: false,
    };
  }

  if (route.lockedTool === 'gmail' && route.lockedAction === 'getEmail') {
    return {
      tool: 'gmail',
      action: 'getEmail',
      input: {
        id: route.entities.emailId || route.entities.messageId || '',
      },
      riskLevel: 'low',
      requiresApproval: false,
    };
  }

  if (route.lockedTool === 'jira' && route.lockedAction === 'searchIssues') {
    const flags = jiraSearchFlags(query);
    const project = (route.entities.project || process.env.JIRA_DEFAULT_PROJECT || '').trim().toUpperCase();
    return {
      tool: 'jira',
      action: 'searchIssues',
      input: {
        query,
        ...(project ? { project } : {}),
        ...flags,
        limit: 10,
      },
      riskLevel: 'low',
      requiresApproval: false,
    };
  }

  if (route.lockedTool === 'notion' && route.lockedAction === 'searchPages') {
    const topic =
      query.match(/\b(?:about|for|on|regarding)\s+(.+?)(?:\.|$|\?)/i)?.[1]?.trim() ||
      query.replace(/\b(find|search|show|get|latest|the|project|documentation|docs?)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) ||
      query.slice(0, 80);
    return {
      tool: 'notion',
      action: 'searchPages',
      input: { query: topic },
      riskLevel: 'low',
      requiresApproval: false,
    };
  }

  if (route.lockedTool === 'gmail' && route.lockedAction === 'sendEmail') {
    const emailTo = query.match(/\bto\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i)?.[1];
    const subjectMatch =
      query.match(/\babout\s+(.+?)(?:\.|$)/i)?.[1]?.trim() ||
      query.match(/\bregarding\s+(.+?)(?:\.|$)/i)?.[1]?.trim() ||
      query.match(/\bsubject\s+["']?([^"'\n]+)["']?/i)?.[1]?.trim();
    return {
      tool: 'gmail',
      action: 'sendEmail',
      input: {
        ...(emailTo ? { to: emailTo } : {}),
        ...(subjectMatch ? { subject: subjectMatch.slice(0, 120) } : {}),
        body: `Hi,\n\n${query.trim()}\n\n— Drafted by Nexora (awaiting approval before send)`,
      },
      riskLevel: requiresApproval ? 'high' : 'low',
      requiresApproval,
    };
  }

  return {
    tool: route.lockedTool,
    action: route.lockedAction,
    input: { ...route.entities, query },
    riskLevel: requiresApproval ? 'high' : 'low',
    requiresApproval,
  };
}

export function missingFieldsForJiraCreate(input: Record<string, unknown>): string[] {
  const missing: string[] = [];
  const summary = String(input.summary ?? '').trim();
  const project = String(input.project ?? '').trim();
  if (!project) missing.push('project');
  if (!summary || summary.length < 3) missing.push('summary');
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
  route?: AuthoritativeRoute;
}): RoutingDecisionRecord {
  const missingFields: string[] = [];
  for (const c of args.selected) {
    if (c.tool === 'jira' && c.action === 'createIssue') {
      missingFields.push(...missingFieldsForJiraCreate(c.input));
    }
    if (c.tool === 'gmail' && c.action === 'sendEmail') {
      if (!String(c.input.to ?? '').trim()) missingFields.push('to');
      if (!String(c.input.subject ?? '').trim()) missingFields.push('subject');
      if (!String(c.input.body ?? c.input.text ?? '').trim()) missingFields.push('body');
    }
  }

  let validation: RoutingDecisionRecord['validation'] = 'passed';
  let execution: RoutingDecisionRecord['execution'] = 'not_started';

  if (args.mode === 'cancel') {
    validation = 'cancelled';
    execution = 'skipped';
  } else if (args.mode === 'clarify' || args.route?.ambiguous) {
    validation = 'needs_info';
    execution = 'skipped';
  } else if (args.mode === 'dry_run') {
    validation = 'dry_run';
    execution = 'skipped';
  } else if (missingFields.includes('summary')) {
    validation = 'needs_info';
  }

  if (args.pendingApprovalIds.length > 0) execution = 'queued_approval';
  else if (args.executedCount > 0) execution = 'executed';
  else if (args.mode !== 'execute') execution = 'skipped';

  return {
    requestMode: args.mode,
    intentKind: args.intent.kind,
    intentFamily: args.family,
    lockedTool: args.route?.lockedTool ?? null,
    lockedAction: args.route?.lockedAction ?? null,
    entities: args.route?.entities,
    ambiguous: args.route?.ambiguous,
    allowedTools: allowedToolsForFamily(args.family),
    selectedTools: args.selected.map((c) => ({ tool: c.tool, action: c.action })),
    strippedTools: args.stripped,
    missingFields: [...new Set(missingFields)],
    validation,
    execution,
    rationale: args.route?.rationale || args.intent.rationale,
  };
}

export function clarifyReplyForJira(_query: string): string {
  return (
    `I understand you want a **Jira ticket**, but I’m not creating anything yet.\n\n` +
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
