import type { OsIntent, WorkflowKind, QueryIntent } from '@enterprise-ai-os/shared';

// ============================================================
// STEP 1 — Intent Detector
// Prefer explicit Slack/Notion product intent. Never treat a
// Notion URL inside a Slack command as a Notion workflow.
// ============================================================

interface IntentRule {
  kind: WorkflowKind;
  confidence: number;
  test: (q: string) => boolean;
  entities?: (q: string) => Record<string, string>;
  rationale: string;
}

/** Strip http(s) URLs so https://notion.so does not trigger Notion intent. */
function stripUrls(q: string): string {
  return q.replace(/https?:\/\/[^\s<>"']+/gi, ' ');
}

function projectEntity(q: string): Record<string, string> {
  const quoted = q.match(/["“]([^"”]+)["”]/)?.[1];
  const named =
    q.match(/(?:for|project|called|named)\s+@?([A-Za-z0-9][\w .-]{1,40})/i)?.[1]?.trim() ??
    q.match(/\bversion\s+(\d+(?:\.\d+)*)/i)?.[1] ??
    q.match(/\batlas\b/i)?.[0];
  return { project: quoted || named || 'project' };
}

/**
 * Questions that should READ Slack (search/history/intel), not write (post/create).
 * e.g. "why was the project hello delayed on slack"
 */
export function isSlackReadQuestion(q: string): boolean {
  const lower = q.toLowerCase();
  const hasWriteVerb =
    /\b(post|send|create|make|invite|upload|pin|remind|bookmark|canvas|schedule|set\s+(?:the\s+)?(?:topic|purpose))\b/.test(
      lower
    );
  if (hasWriteVerb) return false;

  const asksWhy =
    /\b(why|what happened|what'?s happening|whats happening|how come|reason|status of)\b/.test(lower) ||
    /\?/.test(q);
  const delayOrBlocker =
    /\b(delay|delayed|slip|slipped|blocked|blocker|stuck|behind|didn'?t happen|not happen|not happening)\b/.test(
      lower
    );
  const discusses =
    /\b(discussed|talked about|mentioned|said about|find where|who owns|decision|complaints?|unanswered|summarize|summarise|recap)\b/.test(
      lower
    );
  const slackish = /\bslack\b/.test(lower) || /\bon\s+slack\b/.test(lower) || /#([a-z0-9_-]+)/i.test(q);

  // why/delay questions are intelligence even without saying "slack"
  if ((asksWhy && delayOrBlocker) || (asksWhy && slackish) || (delayOrBlocker && slackish) || discusses) {
    return true;
  }
  return false;
}

export function isExplicitSlackCommand(q: string): boolean {
  const lower = q.toLowerCase();
  // Read/intelligence questions must NOT be treated as write CRUD
  if (isSlackReadQuestion(q)) return false;

  if (/\bon\s+slack\b/.test(lower)) return true;
  if (
    /\bslack\b/.test(lower) &&
    /\b(post|send|message|bookmark|topic|purpose|history|invite|react|canvas|channel|digest|list|pin|remind|reminder|search)\b/.test(
      lower
    )
  )
    return true;
  if (/\bbookmark\b/.test(lower) && /#([a-z0-9_-]+)/i.test(lower)) return true;
  if (/\b(set|change)\s+(topic|purpose)\b/.test(lower)) return true;
  if (/\b(post|send)\b/.test(lower) && /#([a-z0-9_-]+)/i.test(lower)) return true;
  if (/\b(show|get|read|fetch)\s+history\b/.test(lower)) return true;
  if (/\b(pin)\b/.test(lower) && /\b(message|msg)\b/.test(lower)) return true;
  if (/\b(list)\b/.test(lower) && /\b(pins?|pinned)\b/.test(lower)) return true;
  if (/\b(remind|schedule reminder)\b/.test(lower) && /#([a-z0-9_-]+)/i.test(lower)) return true;
  if (/\binvite\b/.test(lower) && (/\bslack\b/.test(lower) || /#([a-z0-9_-]+)/i.test(lower) || /@/.test(lower))) return true;
  return false;
}

export function isExplicitNotionCommand(q: string): boolean {
  const text = stripUrls(q.toLowerCase());
  // Slack wins if both mentioned as destination
  if (isExplicitSlackCommand(q) && /\bon\s+slack\b/.test(q.toLowerCase())) return false;
  if (/\bon\s+notion\b/.test(text)) return true;
  if (/\bnotion\b/.test(text) && /\b(page|doc|prd|wiki|database|project|meeting|roadmap|create|search|archive|publish)\b/.test(text))
    return true;
  if (/\b(prd|wiki|meeting notes|sprint board)\b/.test(text) && !/\bslack\b/.test(text)) return true;
  return false;
}

const RULES: IntentRule[] = [
  {
    kind: 'launch_workflow',
    confidence: 0.94,
    rationale: 'Launch / war-room style project kickoff',
    test: (q) =>
      /\b(war\s*room|launch\s+room|launch\s+war)\b/.test(q) ||
      (/\blaunch\b/.test(q) && /\b(project|version|atlas|v\d)\b/.test(q)) ||
      (/\b(spin\s*up|kick\s*off)\b/.test(q) && /\b(project|launch|room)\b/.test(q)),
    entities: projectEntity,
  },
  {
    kind: 'incident_workflow',
    confidence: 0.95,
    rationale: 'Production incident / outage response',
    test: (q) => /\b(production\s+)?incident\b/.test(q) || /\b(outage|sev[-\s]?\d|p0|p1)\b/.test(q),
    entities: (q) => ({
      severity: q.match(/\b(sev[-\s]?\d|p[0-3])\b/i)?.[1] ?? 'sev-2',
      summary: q.slice(0, 200),
    }),
  },
  {
    kind: 'standup_workflow',
    confidence: 0.92,
    rationale: 'Standup / digest multi-tool prep',
    test: (q) =>
      /\b(standup|stand-up)\b/.test(q) ||
      /\b(daily\s+digest|weekly\s+digest|prepare\s+tomorrow)\b/.test(q) ||
      (/\bdigest\b/.test(q) && /\b(daily|weekly)\b/.test(q)),
  },
  {
    kind: 'reminder_workflow',
    confidence: 0.9,
    rationale: 'Follow-ups / pending approvals / nudges',
    test: (q) =>
      // Channel "remind #foo in 60 minutes" is a simple scheduleReminder — not this workflow
      !( /\bremind\b/.test(q) && /#([a-z0-9_-]+)/i.test(q) ) &&
      (/\b(follow[- ]?up|nudge)\b/.test(q) ||
        (/\bremind\b/.test(q) && /\b(everyone|team|approv|pending)\b/.test(q)) ||
        /\bwaiting for approvals?\b/.test(q)),
  },
  {
    kind: 'workspace_intelligence',
    confidence: 0.93,
    rationale: 'Search / summarize / blockers / delay reasons / decisions',
    test: (q) =>
      isSlackReadQuestion(q) ||
      (!isExplicitSlackCommand(q) &&
        (/\b(blocker|blocked|summarize|summarise|recap|complaint|unanswered|dead channel|who owns|decid|discussed|semantic search|action items?|delay|delayed|slip)\b/.test(
          q
        ) ||
          /\bwhat blocked\b/.test(q) ||
          /\bfind where we\b/.test(q) ||
          /\bwhy\b/.test(q))),
    entities: projectEntity,
  },
  {
    kind: 'notion_project',
    confidence: 0.88,
    rationale: 'Notion project / PRD / wiki / meeting notes',
    test: (q) => isExplicitNotionCommand(q),
    entities: (q) => ({
      title:
        q.match(/["“]([^"”]+)["”]/)?.[1] ??
        q.match(/(?:titled|called|named)\s+([^"\n]+)/i)?.[1]?.trim() ??
        stripUrls(q).slice(0, 60).trim(),
    }),
  },
  {
    kind: 'simple_action',
    confidence: 0.9,
    rationale: 'Single-tool action (Slack/Notion/Gmail/Jira/CRM)',
    test: (q) =>
      isExplicitSlackCommand(q) ||
      /\b(draft|email|e-mail|gmail|mail)\b/.test(q) ||
      /\b(jira|ticket|salesforce|crm|opportunity)\b/.test(q) ||
      /\b(create|make|post|send|list|invite|upload|search|react|bookmark|canvas|set|topic|purpose|history|show|get|pin|remind|reminder)\b/.test(
        q
      ),
  },
];

export function detectOsIntent(query: string): OsIntent {
  const q = query.toLowerCase();

  // Read/intelligence questions first — never force postMessage for "why … on slack"
  if (isSlackReadQuestion(query)) {
    return {
      kind: 'workspace_intelligence',
      confidence: 0.96,
      rationale: 'Slack read/intelligence question — search history for reasons, not write actions',
      legacyIntent: 'read',
      entities: projectEntity(query),
    };
  }

  // Multi-step workflows beat "on slack" CRUD short-circuit so war rooms /
  // incidents / standups still run even when the user says "on slack".
  const workflowKinds = new Set([
    'launch_workflow',
    'incident_workflow',
    'standup_workflow',
    'reminder_workflow',
    'workspace_intelligence',
    'notion_project',
  ]);
  for (const rule of RULES) {
    if (!workflowKinds.has(rule.kind)) continue;
    if (rule.test(q)) {
      const legacyIntent: QueryIntent =
        rule.kind === 'workspace_intelligence' ? 'read' : 'action';
      return {
        kind: rule.kind,
        confidence: rule.confidence,
        rationale: rule.rationale,
        legacyIntent,
        entities: rule.entities?.(query) ?? {},
      };
    }
  }

  // Explicit Slack write/CRUD destination (create channel, post, invite, …)
  if (isExplicitSlackCommand(query)) {
    return {
      kind: 'simple_action',
      confidence: 0.96,
      rationale: 'Explicit Slack command — route to Slack tools only',
      legacyIntent: 'action',
      entities: {},
    };
  }

  for (const rule of RULES) {
    if (rule.test(q)) {
      const legacyIntent: QueryIntent = rule.kind === 'read_only' || rule.kind === 'workspace_intelligence' ? 'read' : 'action';
      return {
        kind: rule.kind,
        confidence: rule.confidence,
        rationale: rule.rationale,
        legacyIntent,
        entities: rule.entities?.(query) ?? {},
      };
    }
  }

  return {
    kind: 'read_only',
    confidence: 0.7,
    rationale: 'No operational workflow verbs detected',
    legacyIntent: 'read',
    entities: {},
  };
}
