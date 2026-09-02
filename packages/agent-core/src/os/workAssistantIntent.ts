/**
 * Natural business-language intent helpers for Nexora work assistant.
 * Routes soft NL into real connector families — never invents tool results.
 */

import {
  isExplicitJiraCreate,
  isExplicitNotionCommand,
  isExplicitSlackCommand,
  routingQuery,
} from './intentDetector';
import { isGmailDestinationQuery, isGmailSendQuery } from './gmailQuery';

/** Soft Gmail reads that omit the word "email" (manager / inbox urgency). */
export function isGmailSoftReadQuery(query: string): boolean {
  const t = routingQuery(query).toLowerCase();
  if (isGmailSendQuery(query)) return false;
  if (isGmailDestinationQuery(query)) return true;
  // "urgent from my manager", "anything from my boss"
  if (
    /\b(manager|boss|lead|director|ceo|cto|vp)\b/.test(t) &&
    /\b(urgent|important|priority|anything|from|mail|inbox|message)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(inbox|unread)\b/.test(t) && /\b(check|show|what|any|look)\b/.test(t)) return true;
  return false;
}

/** Jira read / search — pending, overdue, my work — not create/delete. */
export function isJiraReadQuery(query: string): boolean {
  const t = routingQuery(query).toLowerCase();
  if (/\b(create|open|file|log|delete|remove|transition|assign|comment)\b/.test(t) && /\b(ticket|issue|bug)\b/.test(t)) {
    return false;
  }
  if (/\bjira\b/.test(t) && /\b(pending|overdue|open|assigned|search|find|show|list|what|which|my|tasks?|tickets?|issues?|work|finish|due)\b/.test(t)) {
    return true;
  }
  if (/\b(overdue|past\s+due)\b/.test(t) && /\b(tasks?|tickets?|issues?|work|jira)\b/.test(t)) return true;
  if (/\b(pending|open)\b/.test(t) && /\b(jira|tickets?|issues?|tasks?)\b/.test(t)) return true;
  if (/\b(what|which)\b/.test(t) && /\b(tasks?|tickets?|issues?)\b/.test(t) && /\b(overdue|pending|due|finish|assigned)\b/.test(t)) {
    return true;
  }
  // "what do I need to finish today / this week"
  if (
    /\b(finish|complete|get\s+done|wrap\s+up)\b/.test(t) &&
    /\b(today|tonight|this\s+week|tomorrow)\b/.test(t) &&
    !/\b(slack|gmail|email|notion)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(my|show|list)\b/.test(t) && /\b(open|pending)\b/.test(t) && /\b(tasks?|work|tickets?)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Slack team / conversation intelligence without requiring the word "slack". */
export function isSlackSoftReadQuery(query: string): boolean {
  const t = routingQuery(query).toLowerCase();
  if (/\b(post|send|create|invite|bookmark)\b/.test(t) && /#([a-z0-9_-]+)/i.test(query)) return false;
  if (
    /\b(engineering|eng|product|design|sales|finance|ops|team)\b/.test(t) &&
    /\b(happening|discuss|discussed|conversation|talked|update|status|what'?s\s+going)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(find|search|where)\b/.test(t) &&
    /\b(conversation|thread|discussion|chat)\b/.test(t) &&
    !/\b(gmail|email|jira|notion)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(summarize|summarise|recap)\b/.test(t) && /\b(project|acme|alpha|deployment|launch)\b/.test(t) && !/\b(email|gmail|jira|notion)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Contextual work-priority questions — must hit real tools, not generic LLM. */
export function isWorkPulseQuery(query: string): boolean {
  const t = routingQuery(query).toLowerCase();
  return (
    /\b(what'?s|what is)\s+(important|urgent|priority)\b/.test(t) ||
    /\banything\s+(urgent|important)\b/.test(t) ||
    /\bwhat\s+should\s+i\s+(work\s+on|do|focus|prioritize|tackle)\b/.test(t) ||
    /\b(what|anything)\s+(needs|needs?\s+my?\s+attention)\b/.test(t) ||
    /\b(prioritize|priority)\s+(today|this\s+week|my\s+day|now)\b/.test(t) ||
    (/\bimportant\b/.test(t) && /\b(today|this\s+morning|right\s+now)\b/.test(t))
  );
}

/** Pick the best single-tool family for a work-priority question. */
export function workPulseRouteHint(query: string): 'gmail_read' | 'jira' | 'slack_read' {
  const t = routingQuery(query).toLowerCase();
  if (/\b(email|mail|inbox|gmail)\b/.test(t)) return 'gmail_read';
  if (/\b(jira|ticket|task|issue|work on|finish|pending|overdue|assigned)\b/.test(t)) return 'jira';
  if (/\b(slack|team|engineering|channel|discussion)\b/.test(t)) return 'slack_read';
  // Default: important email is the most common “what’s important today” ask
  if (/\b(urgent|important|priority|attention)\b/.test(t)) return 'gmail_read';
  return 'jira';
}

/** Documentation / knowledge search without saying “Notion”. */
export function isNotionDocQuery(query: string): boolean {
  const t = routingQuery(query).toLowerCase();
  // Never treat create/update/delete as a doc search
  if (/\b(create|make|new|update|edit|delete|archive|publish|write)\b/.test(t)) {
    return false;
  }
  if (
    /\bnotion\b/.test(t) &&
    /\b(search|find|show|get|latest|look\s+for|where)\b/.test(t) &&
    /\b(pages?|docs?|documents?|wiki|prd|project)\b/.test(t)
  ) {
    return true;
  }
  return (
    /\b(find|search|show|get|latest|where\s+is|look\s+for)\b/.test(t) &&
    /\b(documentation|docs?|wiki|prd|knowledge\s+base|project\s+(doc|documentation|plan|update|spec))\b/.test(t) &&
    !/\b(gmail|email|jira|slack|ticket)\b/.test(t)
  );
}

/** Slack search → Jira create cross-tool pattern. */
export function isCrossToolSlackJiraQuery(query: string): boolean {
  const t = routingQuery(query).toLowerCase();
  const wantsJiraCreate =
    /\b(create|open|file|log|track|make)\b/.test(t) && /\b(jira|ticket|issue|bug)\b/.test(t);
  // Must be find/search Slack first — not "notify Slack" after a Jira create
  const wantsSlackFind =
    (/\b(find|search|look\s+for|latest|recent)\b/.test(t) &&
      (/\bslack\b/.test(t) || isSlackSoftReadQuery(query))) ||
    (/\b(find|search|look\s+for|latest|recent)\b/.test(t) &&
      /\b(issue|problem|bug|discussion|conversation|update|customer)\b/.test(t) &&
      /\bslack\b/.test(t));
  // Explicit "and create a jira" after slack find
  const andCreate =
    /\b(and|,)\s*(then\s+)?(create|open|file|make)\b/.test(t) ||
    /\bcreate\s+(a\s+)?(jira\s+)?(ticket|issue|bug)\b/.test(t);
  if (!wantsJiraCreate || !wantsSlackFind || !andCreate) return false;
  // Exclude notify/post/send as the Slack verb (write, not search)
  if (/\b(notify|post|send|message)\b/.test(t) && !/\b(find|search|look\s+for)\b/.test(t)) return false;
  return true;
}

/** Short follow-up that should reuse prior turn context (handled via memory / history). */
export function isFollowUpContinuation(query: string): boolean {
  const t = routingQuery(query).trim().toLowerCase();
  return /^(do that|do it|yes\.?|go ahead|please do|that one|same thing|follow up)$/i.test(t);
}

/** Mutation / write intents — must route to real connectors, never generic LLM simulation. */
export function isActionMutationQuery(query: string): boolean {
  const t = routingQuery(query).toLowerCase();
  if (isGmailSendQuery(query)) return true;
  if (isExplicitJiraCreate(query) || isExplicitSlackCommand(query) || isExplicitNotionCommand(query)) {
    return true;
  }
  const mutationVerb =
    /\b(create|make|open|file|log|track|new|update|edit|delete|remove|send|post|invite|launch|announce)\b/.test(t);
  if (!mutationVerb) return false;
  if (/\b(war\s*room|launch\s+war|channel|ticket|issue|bug|page|doc|document|email|mail|message|announcement|project)\b/.test(t)) {
    return true;
  }
  if (/\b(slack|jira|notion|gmail)\b/.test(t)) return true;
  if (/\b(on\s+slack|in\s+jira|in\s+notion|via\s+gmail)\b/.test(t)) return true;
  return false;
}

/** Any query that must use workspace tools — reads OR writes. */
export function impliesWorkspaceExecution(query: string): boolean {
  return impliesLiveWorkspaceData(query) || isActionMutationQuery(query);
}

/** Skip vector/graph retrieval for deterministic action routes (latency). */
export function shouldSkipHybridRetrieve(
  route: { mode: string; ambiguous?: boolean; lockedTool?: string | null; lockedAction?: string | null; allowWorkflow?: boolean; osIntent?: { kind?: string } },
  query: string
): boolean {
  if (route.mode !== 'execute' || route.ambiguous) return false;
  const live = routingQuery(query);
  if (route.lockedTool && route.lockedAction) return true;
  if (isActionMutationQuery(live)) return true;
  const kind = route.osIntent?.kind ?? '';
  if (route.allowWorkflow && kind && kind !== 'workspace_intelligence' && kind !== 'read_only') {
    return true;
  }
  return false;
}

/** True when the route must never fall back to generic LLM conversational prose. */
export function isActionRouteIntent(
  route: { mode: string; lockedTool?: string | null; routeAction?: string; ambiguous?: boolean },
  query: string
): boolean {
  if (route.ambiguous) return false;
  if (route.mode === 'execute' && route.lockedTool) return true;
  if (route.mode === 'execute' && route.routeAction && route.routeAction !== 'unknown' && route.routeAction !== 'read') {
    return true;
  }
  return isActionMutationQuery(routingQuery(query));
}

/** Any query that implies live workspace data — never answer from generic LLM alone. */
export function impliesLiveWorkspaceData(query: string): boolean {
  return (
    isGmailSoftReadQuery(query) ||
    isGmailDestinationQuery(query) ||
    isJiraReadQuery(query) ||
    isSlackSoftReadQuery(query) ||
    isWorkPulseQuery(query) ||
    isNotionDocQuery(query) ||
    isCrossToolSlackJiraQuery(query) ||
    isFollowUpContinuation(query)
  );
}

export type GmailSearchMemory = {
  query?: string;
  gmailQuery?: string;
  emails?: Array<{ id?: string; threadId?: string; subject?: string; from?: string }>;
};

/**
 * Expand short follow-ups using last Gmail search memory.
 * e.g. "only this week" → prior NL + "this week"; "summarize the second" → getEmail id.
 */
export function expandGmailFollowUp(
  query: string,
  memory: GmailSearchMemory | null | undefined
): { query: string; getEmailId?: string; summarizeIndex?: number } {
  const live = routingQuery(query).trim();
  const lower = live.toLowerCase();
  if (!memory?.emails?.length && !memory?.query && !memory?.gmailQuery) {
    return { query: live };
  }

  const nth =
    lower.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\b/) ||
    lower.match(/\b#(\d+)\b/);
  const wantsSummarize = /\b(summarize|summarise|read|open|show|get)\b/.test(lower);
  if (nth && (wantsSummarize || /\b(one|email|message|that)\b/.test(lower) || /^(the\s+)?(first|second|third|\d)/.test(lower))) {
    let index = 0;
    const word = String(nth[1] || nth[0] || '')
      .toLowerCase()
      .replace(/^(the\s+)/, '');
    if (word === 'first' || word === '1' || word === '1st') index = 0;
    else if (word === 'second' || word === '2' || word === '2nd') index = 1;
    else if (word === 'third' || word === '3' || word === '3rd') index = 2;
    else if (word === 'fourth' || word === '4' || word === '4th') index = 3;
    else if (word === 'fifth' || word === '5' || word === '5th') index = 4;
    else {
      const n = parseInt(word.replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n >= 1) index = n - 1;
    }
    const email = memory.emails?.[index];
    if (email?.id) {
      return { query: live, getEmailId: String(email.id), summarizeIndex: index };
    }
  }

  // Refinement without restating the whole search
  const isRefinement =
    /^(only|just|from|this|last|past|unread|important|starred|with)\b/.test(lower) ||
    /\bonly\s+(the\s+)?ones?\b/.test(lower) ||
    (/^(filter|narrow|limit)\b/.test(lower) && memory.query);

  if (isRefinement && (memory.query || memory.gmailQuery)) {
    const base = String(memory.query || '').trim() || 'emails';
    return { query: `${base}. ${live}`.trim() };
  }

  return { query: live };
}

/** Build JQL hints from NL for searchIssues. */
export function jiraSearchFlags(query: string): {
  overdueOnly?: boolean;
  pendingOnly?: boolean;
  dueToday?: boolean;
  assigneeMe?: boolean;
} {
  const t = routingQuery(query).toLowerCase();
  return {
    overdueOnly: /\b(overdue|past\s+due)\b/.test(t),
    pendingOnly: /\b(pending|open|unresolved|to\s*do|todo|in\s+progress)\b/.test(t) && !/\boverdue\b/.test(t),
    dueToday: /\b(today|tonight)\b/.test(t) && /\b(finish|due|complete|need)\b/.test(t),
    assigneeMe: /\b(my|assigned\s+to\s+me|i\s+need)\b/.test(t),
  };
}
