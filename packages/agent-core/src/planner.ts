import type { AgentPlan, ClassifiedIntent, RetrievedContext, ToolCall, ToolName } from '@enterprise-ai-os/shared';
import { isHighConsequence } from '@enterprise-ai-os/shared';
import type { LLMClient } from './llmClient';
import { isExplicitNotionCommand, isExplicitSlackCommand } from './os/intentDetector';

// ============================================================
// LLM Planner — the "reasoning engine" box in the architecture
// diagram. Given the classified intent and hybrid-retrieved
// context, produces:
//   1. a natural-language response draft (via the LLM client)
//   2. zero or more proposed tool calls (via Structured Outputs /
//      Function Calling in a real deployment)
//
// This mock planner uses simple keyword rules to *propose* tool
// calls instead of a real function-calling round trip — swap the
// `proposeToolCalls` body for an Anthropic/OpenAI tool-use call
// once a live LLM provider is wired in llmClient.ts. The risk
// classification and approval-gating logic below, however, is
// real and provider-independent: every proposed call is checked
// against the shared HIGH_CONSEQUENCE_ACTIONS policy.
// ============================================================

interface ToolRule {
  tool: ToolName;
  action: string | ((query: string) => string);
  keywords: string[];
  buildInput: (query: string) => Record<string, unknown>;
  /** Extra matcher for demo-friendly NL (e.g. create channel without saying "slack") */
  match?: (query: string) => boolean;
}

const TOOL_RULES: ToolRule[] = [
  {
    tool: 'gmail',
    action: 'sendEmail',
    keywords: [
      'email',
      'e-mail',
      'gmail',
      'mail',
      'draft an email',
      'draft email',
      'send an email',
      'send email',
      'write an email',
      'compose an email',
    ],
    match: (query: string) =>
      /\b(draft|compose|write|send)\b/i.test(query) && /\b(email|e-mail|mail|gmail)\b/i.test(query),
    buildInput: (query) => {
      const emailTo = query.match(/\bto\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i)?.[1];
      const subjectMatch =
        query.match(/\babout\s+(.+?)(?:\.|$)/i)?.[1]?.trim() ||
        query.match(/\bregarding\s+(.+?)(?:\.|$)/i)?.[1]?.trim() ||
        'Update on your project';
      return {
        to: emailTo || 'client@example.com',
        subject: subjectMatch.slice(0, 120),
        body: `Hi,\n\n${query.trim()}\n\n— Drafted by Nexora (awaiting approval before send)`,
      };
    },
  },
  {
    tool: 'jira',
    action: 'searchIssues',
    keywords: ['blocking', 'blocked', 'blocker', 'what is blocking', "what's blocking"],
    match: (query: string) =>
      /\b(what('?s| is)?\s+blocking|blockers?\s+(for|on)|find\s+blockers?)\b/i.test(query) ||
      (/\b(blocking|blocked)\b/i.test(query) && /\b(project|jira|ticket|issue)\b/i.test(query)),
    buildInput: (query) => {
      const projectHint =
        query.match(/\bproject\s+([A-Za-z0-9_-]+)/i)?.[1] ||
        query.match(/\b([A-Z]{2,10})\b/)?.[1] ||
        process.env.JIRA_DEFAULT_PROJECT ||
        'KAN';
      return {
        project: projectHint,
        query,
        blockedOnly: true,
        limit: 10,
      };
    },
  },
  {
    tool: 'jira',
    action: 'transitionIssue',
    keywords: ['move', 'transition', 'in progress', 'done', 'to do'],
    match: (query: string) =>
      /\b(move|transition)\b/i.test(query) &&
      /\b([A-Z][A-Z0-9]+-\d+)\b/.test(query) &&
      /\b(to|into)\b/i.test(query),
    buildInput: (query) => {
      const key = query.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] || '';
      const status =
        query.match(/\b(?:to|into)\s+["']?([A-Za-z][A-Za-z0-9 /-]+?)["']?(?:\s*$|\.|\,)/i)?.[1]?.trim() ||
        query.match(/\bIn Progress\b/i)?.[0] ||
        'In Progress';
      return { key, status };
    },
  },
  {
    tool: 'jira',
    action: 'addComment',
    keywords: ['comment', 'add a comment', 'leave a comment'],
    match: (query: string) =>
      /\b(add|leave|post)\b/i.test(query) &&
      /\bcomment\b/i.test(query) &&
      (/\b([A-Z][A-Z0-9]+-\d+)\b/.test(query) || /\bjira\b/i.test(query)),
    buildInput: (query) => {
      const key = query.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] || '';
      const body =
        query.match(/comment(?:\s+for\s+\w+)?(?:\s+on\s+[A-Z][A-Z0-9]+-\d+)?[:\s]+(.+)/i)?.[1]?.trim() ||
        query.match(/["“]([^"”]+)["”]/)?.[1] ||
        query;
      return { key, body: body.slice(0, 4000) };
    },
  },
  {
    tool: 'jira',
    action: 'updateIssue',
    keywords: ['assign', 'priority', 'due date', 'label', 'labels'],
    match: (query: string) =>
      /\b([A-Z][A-Z0-9]+-\d+)\b/.test(query) &&
      /\b(assign|priority|due\s*date|label)\b/i.test(query),
    buildInput: (query) => {
      const key = query.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] || '';
      const priority = query.match(/\bpriority\s+(Highest|High|Medium|Low|Lowest)\b/i)?.[1];
      const dueDate = query.match(/\bdue\s*(?:date)?\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1];
      const assignee = query.match(/\bassign(?:\s+to)?\s+([^\s,]+@[^\s,]+|\w[\w.-]+)/i)?.[1];
      const labels = query.match(/\blabels?\s+([a-z0-9,_-]+)/i)?.[1];
      return {
        key,
        ...(priority ? { priority } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(assignee ? { assignee } : {}),
        ...(labels ? { labels } : {}),
      };
    },
  },
  {
    tool: 'jira',
    action: 'linkIssues',
    keywords: ['blocks', 'blocked by', 'link issue', 'link ticket'],
    match: (query: string) =>
      /\b(blocks|blocked by|link)\b/i.test(query) &&
      (query.match(/\b([A-Z][A-Z0-9]+-\d+)\b/g) || []).length >= 2,
    buildInput: (query) => {
      const keys = query.match(/\b([A-Z][A-Z0-9]+-\d+)\b/g) || [];
      const blockedBy = /\bblocked by\b/i.test(query);
      return {
        from: keys[0],
        to: keys[1],
        linkType: blockedBy ? 'Blocks' : 'Blocks',
        inwardKey: blockedBy ? keys[0] : keys[1],
        outwardKey: blockedBy ? keys[1] : keys[0],
      };
    },
  },
  {
    tool: 'jira',
    action: 'createIssue',
    keywords: ['jira', 'ticket', 'issue', 'task', 'risk'],
    match: (query: string) =>
      /\bjira\b/i.test(query) &&
      /\b(create|open|file|log|track)\b/i.test(query) &&
      /\b(ticket|issue|task|risk|bug)\b/i.test(query),
    buildInput: (query) => {
      const titled =
        query.match(/(?:titled|called|named)\s+["']?([^"'\n.]+)["']?/i)?.[1]?.trim() ||
        query.match(/create (?:a )?(?:jira )?(?:ticket|issue|task|risk)(?: for| about)?\s+(.+)/i)?.[1]?.trim();
      const wantsRisk = /\brisk\b/i.test(query);
      const summary = (titled || query.replace(/\bjira\b/gi, '').trim() || query).slice(0, 100);
      const priority = query.match(/\bpriority\s+(Highest|High|Medium|Low|Lowest)\b/i)?.[1];
      const labels = query.match(/\blabels?\s+([a-z0-9,_-]+)/i)?.[1];
      return {
        project: process.env.JIRA_DEFAULT_PROJECT || 'KAN',
        summary: wantsRisk && !/\brisk\b/i.test(summary) ? `Risk: ${summary}`.slice(0, 255) : summary,
        description: query,
        issueType: wantsRisk ? 'Risk' : 'Task',
        ...(priority ? { priority } : {}),
        ...(labels ? { labels } : {}),
        ...(wantsRisk ? { sev: 'SEV-2', environment: 'production', deploymentRisk: 'high' } : {}),
      };
    },
  },
  {
    tool: 'slack',
    action: 'postMessage',
    keywords: [
      'slack',
      'post a message',
      'post message',
      'notify the team',
      'send a message',
      'send message',
      'post "',
      "post '",
      'to @',
      '#general',
      'to #',
      'list channels',
      'list slack',
      'slack channels',
      'slack users',
      'search slack',
      'slack history',
      'channel history',
      'show history',
      'get history',
      'read history',
      'message history',
      'summarize channel',
      'summarise channel',
      'upload to slack',
      'upload file',
      'react on slack',
      'add reaction',
      'create channel',
      'create a channel',
      'create new channel',
      'new channel',
      'make a channel',
      'make channel',
      'chaanel',
      'chanel',
      'invite to',
      'war room',
      'warroom',
      'incident',
      'outage',
      'daily digest',
      'weekly digest',
      'standup',
      'stand-up',
      'blocker',
      'blocked',
      'unanswered',
      'complaint',
      'follow up',
      'follow-up',
      'action item',
      'canvas',
      'bookmark',
      'set topic',
      'channel topic',
      'show history',
      'get history',
      'dead channel',
      'meeting notes',
      'semantic search',
    ],
    buildInput: (query) => parseSlackActionQuery(query),
    match: (query: string) => {
      const lower = query.toLowerCase();
      if (/\b(teams|discord|whatsapp)\b/.test(lower) && !/\bslack\b/.test(lower)) return false;
      if (isExplicitSlackCommand(query)) return true;
      if (/\b(create|make)\b/.test(lower) && /\b(channel|chaanel|chanel|chnnel|war\s*room|incident)\b/.test(lower))
        return true;
      if (/\bnew\s+(?:slack\s+)?channel\b/.test(lower)) return true;
      if (/\b(production\s+)?incident\b/.test(lower) || /\boutage\b/.test(lower)) return true;
      if (/\b(war\s*room|launch\s+war)\b/.test(lower)) return true;
      if (/\b(digest|standup|stand-up)\b/.test(lower)) return true;
      if (/\b(blocker|blocked|unanswered|complaint|follow[- ]?up)\b/.test(lower)) return true;
      if (/\b(post|send|notify|message)\b/.test(lower) && /(#\w+|@\w+|\bgeneral\b)/.test(lower)) return true;
      if (/\b(list)\b/.test(lower) && /\b(channels?|users?|members?)\b/.test(lower) && !/\b(jira|notion|gmail)\b/.test(lower))
        return true;
      if (/\b(summarize|summarise|recap)\b/.test(lower) && /\b(channel|slack|thread|product|engineering)\b/.test(lower)) return true;
      if (/\bfind where we (?:discussed|talked)\b/.test(lower)) return true;
      if (/\b(who owns|find owner|what did we decide)\b/.test(lower)) return true;
      if (/\b(set\s+topic|bookmark|show history|get history|invite)\b/.test(lower)) return true;
      if (/\b(edit|update|delete)\b/.test(lower) && /\b(message|msg|post)\b/.test(lower)) return true;
      if (/\b(permalink|join\s+(?:the\s+)?channel|open\s+dm|direct message)\b/.test(lower)) return true;
      return false;
    },
  },
  {
    tool: 'salesforce',
    action: 'updateRecord',
    keywords: ['salesforce', 'opportunity', 'crm record'],
    buildInput: (query) => ({ object: 'Opportunity', recordId: '0061-ACME', changes: { notes: query } }),
  },
  {
    tool: 'notion',
    action: 'createPage',
    keywords: ['notion', 'wiki page', 'doc page', 'notion page', 'notion doc', 'meeting note', 'meeting notes', 'task', 'todo', 'task list', 'checklist', 'database', 'db', 'table', 'board', 'kanban', 'form', 'survey', 'delete', 'remove', 'archive', 'summary', 'summarize'],
    buildInput: (query) => parseNotionActionQuery(query),
    match: (query: string) => isExplicitNotionCommand(query),
  },
];

function parseSlackActionQuery(query: string): Record<string, unknown> {
  const lower = query.toLowerCase();

  const quoted =
    query.match(/["“]([^"”]+)["”]/)?.[1] ??
    query.match(/'([^']+)'/)?.[1];

  const userMention = query.match(/@([a-z0-9._-]+)/i)?.[1];
  const channelMatch =
    query.match(/#([a-z0-9_-]+)/i)?.[1] ??
    query.match(/\bchannel\s+[\"']?([a-z0-9_-]+)/i)?.[1] ??
    query.match(/(?:to|in|into)\s+#([a-z0-9_-]+)\b/i)?.[1];

  const reserved = new Set(['slack', 'channel', 'channels', 'message', 'messages', 'team', 'the', 'a', 'an', 'on', 'to', 'in']);
  let channel = userMention ? `@${userMention}` : channelMatch ?? 'general';
  if (!userMention && reserved.has(String(channel).toLowerCase())) {
    channel = 'general';
  }

  // ---- PRIORITY: post/send message (must beat createChannel; "#new-channel" contains "new"+"channel") ----
  const isPostOrSend =
    /\b(post|send)\b/.test(lower) &&
    (Boolean(quoted) || /\bto\s+#/.test(lower) || /\bto\s+@/.test(lower) || /\bon\s+slack\b/.test(lower));
  if (isPostOrSend && !/\b(create|make)\s+(?:a\s+)?(?:new\s+)?channel\b/.test(lower)) {
    let text = quoted;
    if (!text) {
      text = query
        .replace(/^(please\s+)?(post|send|notify|message)\s+/i, '')
        .replace(/\s+(to|in|on)\s+#?@[a-z0-9._-]+\s*$/i, '')
        .replace(/\s+(to|in|on)\s+#?[a-z0-9_-]+\s*$/i, '')
        .replace(/\s+on\s+slack\s*$/i, '')
        .replace(/^["“]|["”]$/g, '')
        .trim();
    }
    if (!text) text = query.trim();
    const external = /\b(external|customer|client)\b/.test(lower);
    return {
      action: external ? 'postMessageExternalChannel' : 'postMessage',
      channel,
      text,
    };
  }

  // ---- Bookmark / topic early (before Notion-ish URLs confuse anything) ----
  // WHY / DELAY questions → search Slack, never post
  if (
    /\b(why|what happened|reason|status of)\b/.test(lower) ||
    /\b(delay|delayed|slip|slipped|blocked|blocker|didn'?t happen|not happen)\b/.test(lower)
  ) {
    if (!/\b(post|send|create|make|invite)\b/.test(lower)) {
      const project =
        query.match(/\bproject\s+@?([A-Za-z0-9][\w-]{0,40})/i)?.[1] ??
        query.match(/@([A-Za-z0-9][\w-]{0,40})/)?.[1];
      const searchQ = [project, 'delayed', 'delay', 'because'].filter(Boolean).join(' ');
      return { action: 'semanticSearch', query: searchQ || query };
    }
  }

  // Edit / delete / permalink / join / DM
  if (/\b(edit|update)\b/.test(lower) && /\b(message|msg|post)\b/.test(lower)) {
    const ts = query.match(/\b(\d{10}\.\d+)\b/)?.[1];
    return {
      action: 'updateMessage',
      channel,
      ts,
      text: quoted ?? query.replace(/^.*?to\s+/i, '').slice(0, 3000),
    };
  }

  if (/\b(delete|remove)\b/.test(lower) && /\b(message|msg|post)\b/.test(lower)) {
    const ts = query.match(/\b(\d{10}\.\d+)\b/)?.[1];
    return { action: 'deleteMessage', channel, ts };
  }

  if (/\b(permalink|message link|link to (?:the )?message)\b/.test(lower)) {
    const ts = query.match(/\b(\d{10}\.\d+)\b/)?.[1];
    return { action: 'getPermalink', channel, ts };
  }

  if (/\b(join)\b/.test(lower) && /\b(channel|#)/.test(lower)) {
    return { action: 'joinChannel', channel };
  }

  if (/\b(dm|direct message|message privately)\b/.test(lower) || (/\b(open)\b/.test(lower) && /\bdm\b/.test(lower))) {
    const users = userMention ? [userMention] : [];
    const extra = [...query.matchAll(/@([a-z0-9._-]+)/gi)].map((m) => m[1]);
    return {
      action: 'openDm',
      users: users.length ? users : extra,
      text: quoted,
    };
  }

  if (/\b(bookmark|pin (?:this )?link)\b/.test(lower)) {
    const link = query.match(/https?:\/\/[^\s]+/i)?.[0] ?? '';
    return {
      action: 'createBookmark',
      channel,
      title: quoted ?? (link ? 'Shared link' : 'Bookmark'),
      link,
    };
  }

  if (/\b(set\s+(?:the\s+)?topic|channel topic)\b/.test(lower)) {
    const topic =
      quoted ??
      query.match(/\bto\s+["']([^"']+)["']/i)?.[1] ??
      query.match(/\bto\s+(.+?)(?:\s+on\s+slack)?\s*$/i)?.[1]?.trim() ??
      query.slice(0, 200);
    return { action: 'setChannelTopic', channel, topic };
  }

  if (/\b(set\s+(?:the\s+)?purpose|channel purpose)\b/.test(lower)) {
    const purpose =
      quoted ??
      query.match(/\bto\s+["']([^"']+)["']/i)?.[1] ??
      query.match(/\bto\s+(.+?)(?:\s+on\s+slack)?\s*$/i)?.[1]?.trim() ??
      query.slice(0, 200);
    return { action: 'setChannelPurpose', channel, purpose };
  }

  if (/\b(pin)\b/.test(lower) && /\b(message|msg)\b/.test(lower) && !/\blink\b/.test(lower)) {
    const ts = query.match(/\b(\d{10}\.\d+)\b/)?.[1];
    return { action: 'pinMessage', channel, timestamp: ts };
  }

  if (/\b(list)\b/.test(lower) && /\b(pins?|pinned)\b/.test(lower)) {
    return { action: 'listPins', channel };
  }

  if (/\b(search)\b/.test(lower) && /\b(files?|uploads?|attachments?)\b/.test(lower)) {
    const stripped = query
      .replace(/search( slack)?( for)?( files?|uploads?|attachments?)?/gi, '')
      .replace(/\bon\s+slack\b/gi, '')
      .replace(/\bslack\b/gi, '')
      .trim();
    return { action: 'searchFiles', query: quoted ?? (stripped || query) };
  }

  if (
    (/\b(find|list|get)\b/.test(lower) &&
      /\b(users?|people|members?)\b/.test(lower) &&
      /\b(role|eng|devops|product|design|cto|sre|backend|frontend)\b/.test(lower)) ||
    /\bfind\s+(eng|devops|product|design|cto|sre|backend|frontend)\b/.test(lower)
  ) {
    const roleHints = ['eng', 'devops', 'product', 'design', 'cto', 'sre', 'backend', 'frontend', 'founder'];
    const roles = roleHints.filter((r) => new RegExp(`\\b${r}\\b`, 'i').test(lower));
    return { action: 'findUsersByRole', roles: roles.length ? roles : ['eng'] };
  }

  // ---- Enterprise AI workflows (prefer over basic CRUD) ----
  if (/\b(war\s*room|launch\s+room|launch\s+war)\b/.test(lower) || (/\blaunch\b/.test(lower) && /\b(project|version|v\d)\b/.test(lower) && /\b(create|spin|set\s*up|prepare|open)\b/.test(lower))) {
    const project =
      quoted ??
      query.match(/(?:for|project|called|named)\s+["']?([A-Za-z0-9][\w .-]{1,40})/i)?.[1]?.trim() ??
      query.match(/\bversion\s+(\d+(?:\.\d+)*)/i)?.[1] ??
      'launch';
    return {
      action: 'createWarRoom',
      project,
      name: `war-room-${String(project).toLowerCase().replace(/\s+/g, '-')}`,
      roadmap: `# Roadmap — ${project}\n\n- Kickoff\n- Build\n- QA\n- Launch\n`,
    };
  }

  if (/\b(production\s+)?incident\b/.test(lower) || /\b(sev[-\s]?\d|outage|p0|p1)\b/.test(lower)) {
    const severity = query.match(/\b(sev[-\s]?\d|p[0-3])\b/i)?.[1] ?? 'sev-2';
    return {
      action: 'createIncident',
      severity,
      summary: quoted ?? query.slice(0, 200),
      name: `incident-${severity}-${Date.now().toString(36).slice(-4)}`,
    };
  }

  if (/\b(daily\s+digest|standup\s+digest)\b/.test(lower) || (/\bdigest\b/.test(lower) && /\bdaily\b/.test(lower))) {
    return { action: 'dailyDigest' };
  }
  if (/\b(weekly\s+digest)\b/.test(lower) || (/\bdigest\b/.test(lower) && /\bweekly\b/.test(lower))) {
    return { action: 'weeklyDigest' };
  }
  if (/\b(prepare|generate|create)\b/.test(lower) && /\b(standup|stand-up)\b/.test(lower)) {
    return { action: 'dailyDigest' };
  }

  if (/\bblocker|blocked|blocking\b/.test(lower) || (/\bwhat\b/.test(lower) && /\bblocked\b/.test(lower))) {
    return { action: 'findBlockers', query: quoted ?? query, channel };
  }

  if (/\b(customer\s+complaint|complaints?|angry customer)\b/.test(lower)) {
    return { action: 'findCustomerComplaints', query: quoted ?? 'customer complaint' };
  }

  if (/\b(unanswered|no reply|without replies|waiting for (?:a )?reply)\b/.test(lower)) {
    return { action: 'findUnansweredMessages', channel };
  }

  if (/\b(follow[- ]?up|nudge)\b/.test(lower) && /\b(approv|pending|waiting|everyone)\b/.test(lower)) {
    return { action: 'followUpPendingReplies', dryRun: false, channel };
  }

  if (/\b(action items?|extract todos?|detect todos?)\b/.test(lower)) {
    return { action: 'detectActionItems', channel, query: quoted ?? query };
  }

  if (/\b(dead channels?|stale channels?|inactive channels?|auto[- ]?archive)\b/.test(lower)) {
    return { action: 'detectDeadChannels' };
  }

  if (/\b(find|where).*(decid|decision)\b/.test(lower) || /\b(what did we decide|decision on)\b/.test(lower)) {
    return { action: 'findDecision', query: quoted ?? query };
  }

  if (/\b(who owns|find owner|owner of)\b/.test(lower)) {
    return { action: 'findOwner', topic: quoted ?? query.replace(/who owns|find owner|owner of/gi, '').trim() };
  }

  if (/\b(meeting notes|generate notes)\b/.test(lower)) {
    return { action: 'generateMeetingNotes', channel };
  }

  if (/\b(semantic search|find where we (?:discussed|talked)|discussed)\b/.test(lower) || (/\bfind\b/.test(lower) && /\b(pricing|launch|roadmap)\b/.test(lower))) {
    const stripped = query
      .replace(/find where we (?:discussed|talked about)/i, '')
      .replace(/semantic search( for)?/i, '')
      .trim();
    const q = quoted ?? (stripped || query);
    return { action: 'semanticSearch', query: q };
  }

  if (/\b(create|make|new)\b/.test(lower) && /\bcanvas\b/.test(lower)) {
    const title =
      quoted ??
      query.match(/(?:called|named|titled)\s+["']?([^"'#\n]+?)["']?(?:\s+in\s+|\s+on\s+|\s+for\s+|$)/i)?.[1]?.trim() ??
      'Nexora Canvas';
    return {
      action: 'createCanvas',
      title,
      markdown: `# ${title}\n\n${query}`,
      channel,
    };
  }

  if (/\b(remind|reminder|schedule reminder|schedule message)\b/.test(lower)) {
    const minsRaw = query.match(/in\s+(\d+)\s*(min|minutes?|hours?|hrs?)/i);
    let inMinutes = 60;
    if (minsRaw) {
      const n = Number(minsRaw[1]);
      const unit = minsRaw[2].toLowerCase();
      inMinutes = /hour|hr/.test(unit) ? n * 60 : n;
    }
    const cleaned =
      query
        .replace(/^.*?\b(?:remind|reminder|schedule reminder)\b/i, '')
        .replace(/#\S+/g, '')
        .replace(/\bin\s+\d+\s*(?:min|minutes?|hours?|hrs?)\b/gi, '')
        .replace(/\bon\s+slack\b/gi, '')
        .replace(/^[:\s-]+/, '')
        .trim();
    const text = quoted ?? (cleaned || 'Reminder from Nexora');
    return {
      action: 'scheduleReminder',
      channel,
      text,
      inMinutes,
    };
  }

  if (/\b(list)\b/.test(lower) && /\b(channels?)\b/.test(lower)) {
    return { action: 'listChannels', limit: 200 };
  }
  if (/\b(list)\b/.test(lower) && /\b(users?|members?)\b/.test(lower)) {
    return { action: 'listUsers', limit: 200 };
  }
  if (/\b(search)\b/.test(lower) || (/\b(find|look up)\b/.test(lower) && /\b(slack|history|message)/.test(lower))) {
    const stripped = query
      .replace(/search( in)? slack( history)?( for)?/i, '')
      .replace(/slack/i, '')
      .trim();
    const q = quoted ?? (stripped || query);
    return { action: 'searchHistory', query: q };
  }
  if (/\b(summarize|summarise|recap)\b/.test(lower) && /\b(thread)\b/.test(lower)) {
    const ts = query.match(/\b(\d{10}\.\d+)\b/)?.[1];
    return { action: 'summarizeThread', channel, threadTs: ts, limit: 80 };
  }
  if (/\b(summarize|summarise|recap)\b/.test(lower) && /\b(channel|slack|#|product|engineering|everything)\b/.test(lower)) {
    return { action: 'summarizeChannel', channel, limit: 50, focus: quoted };
  }
  if (/\b(history|messages|thread)\b/.test(lower) && /\b(channel|slack|#|get|read|show|fetch)\b/.test(lower)) {
    if (/\bthread\b/.test(lower)) {
      const ts = query.match(/\b(\d{10}\.\d+)\b/)?.[1];
      return { action: 'getThread', channel, threadTs: ts, limit: 50 };
    }
    return { action: 'getChannelHistory', channel, limit: 50 };
  }
  if (/\b(upload)\b/.test(lower)) {
    return {
      action: 'uploadFile',
      channel,
      content: quoted ?? query,
      filename: 'upload.txt',
      title: 'Chat upload',
    };
  }
  if (/\b(react|reaction)\b/.test(lower)) {
    const emoji = query.match(/:([a-z0-9_+-]+):/i)?.[1] ?? 'thumbsup';
    const ts = query.match(/\b(\d{10}\.\d+)\b/)?.[1];
    return { action: 'addReaction', channel, name: emoji, timestamp: ts };
  }
  // Create channel — require intentional "create/make … channel" or phrase "new channel"
  // NEVER treat "#new-channel" as create (word "new" + "channel" inside a channel name).
  if (
    (/\b(create|make)\b/.test(lower) && /\b(channel|chaanel|chanel|chnnel)\b/.test(lower)) ||
    /\bnew\s+(?:slack\s+)?(?:channel|chaanel|chanel|chnnel)\b/.test(lower)
  ) {
    // "create new channel on slack aryav og" → aryav-og
    // Avoid capturing filler words like "on" / "slack" as the channel name.
    const afterChannel =
      query.match(
        /\b(?:channel|chaanel|chanel|chnnel)\b(?:\s+(?:called|named|titled))?(?:\s+on\s+slack)?\s+(.+)$/i
      )?.[1] ?? '';
    const cleanedTail = afterChannel
      .replace(/\bon\s+slack\b/gi, '')
      .replace(/\bslack\b/gi, '')
      .replace(/["']/g, '')
      .trim();
    const slugFromTail = cleanedTail
      ? cleanedTail
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 70)
      : '';
    const stopNames = new Set(['on', 'slack', 'the', 'a', 'an', 'new', 'called', 'named', 'please']);
    const name =
      quoted ??
      (slugFromTail && !stopNames.has(slugFromTail) ? slugFromTail : undefined) ??
      query.match(/(?:called|named)\s+[#\"']?([a-z0-9][a-z0-9_-]*)/i)?.[1] ??
      (channel !== 'general' && !stopNames.has(String(channel).toLowerCase())
        ? String(channel).replace(/^#/, '')
        : undefined) ??
      `channel-${Date.now().toString(36).slice(-5)}`;
    return { action: 'createChannel', name };
  }
  if (/\b(invite)\b/.test(lower)) {
    const idMatches = query.match(/\b(U[A-Z0-9]+)\b/g) ?? [];
    const atMatches = [...query.matchAll(/@([a-z0-9._-]+)/gi)].map((m) => m[1]);
    const afterInvite =
      query.match(/\binvite\s+(.+?)(?:\s+to\s+#|\s+into\s+#|\s+to\s+the\s+channel|\s+on\s+slack\s*$|$)/i)?.[1] ??
      query.match(/\binvite\s+(.+)$/i)?.[1] ??
      '';
    const nameBits = afterInvite
      .split(/,| and | & |\//i)
      .map((s) =>
        s
          .replace(/@/g, '')
          .replace(/#\S+/g, '')
          .replace(/\bon\s+slack\b/gi, '')
          .replace(/\b(to|into|the|channel|people|members|users|everyone)\b/gi, '')
          .trim()
      )
      .filter((s) => s.length > 1);

    const roleHints = ['eng', 'devops', 'product', 'design', 'cto', 'sre', 'backend', 'frontend', 'founder'];
    const roles = roleHints.filter((r) => new RegExp(`\\b${r}\\b`, 'i').test(afterInvite));

    const users = [...new Set([...idMatches, ...atMatches, ...nameBits.filter((n) => !roleHints.includes(n.toLowerCase()))])];

    // Prefer #channel from "invite X to #channel"
    const inviteChannel =
      query.match(/\bto\s+#([a-z0-9_-]+)/i)?.[1] ??
      query.match(/\binto\s+#([a-z0-9_-]+)/i)?.[1] ??
      channel;

    return {
      action: 'inviteUsers',
      channel: inviteChannel,
      users,
      roles,
    };
  }

  let text = quoted;
  if (!text) {
    text = query
      .replace(/^(please\s+)?(post|send|notify|message)\s+/i, '')
      .replace(/\s+(to|in|on)\s+#?@[a-z0-9._-]+\s*$/i, '')
      .replace(/\s+(to|in|on)\s+#?[a-z0-9_-]+\s*$/i, '')
      .replace(/\s+on\s+slack\s*$/i, '')
      .replace(/^["“]|["”]$/g, '')
      .trim();
  }
  if (!text) text = query.trim();

  const external = /\b(external|customer|client)\b/.test(lower);
  return {
    action: external ? 'postMessageExternalChannel' : 'postMessage',
    channel,
    text,
  };
}

function parseNotionActionQuery(query: string) {
  const lower = query.toLowerCase();
  const isDelete = /\b(delete|remove|archive|destroy|discard)\b/i.test(query) && /\b(page|doc|document|note|task|todo)\b/i.test(query);
  const isPublish = /\b(publish|share|post|submit)\b/i.test(query) && !isDelete;
  const isTask = /\b(?:todo|to-?do|task|tasks|checklist)\b/i.test(query);
  const isMeeting = /\b(?:meeting note|meeting notes|meeting|standup|sync)\b/i.test(query);
  const isSummary = /\b(?:summary|summarize|recap|overview)\b/i.test(query);
  const explicitDatabase = /\b(database|db|table|board|kanban)\b/i.test(query);
  const isFormCreation = /\b(?:create|make|new)\b\s+(?:form|survey|database|db|table|board|kanban)\b/i.test(query);

  const titleMatch =
    query.match(/(?:page|doc|document|note|task|todo|form|survey)\s+(?:called|named|titled)?\s*["“]([^"”]+)["”]/i) ||
    query.match(/(?:page|doc|document|note|task|todo|form|survey)\s+(?:called|named|titled)?\s*([^"\n]+?)(?:\s+with|\s+for|\s+in|\s+about|$)/i);
  const bodyMatch =
    query.match(/(?:body|content|notes|description)\s*(?:is|:)?\s*["“]([^"”]+)["”]/i) ||
    query.match(/(?:body|content|notes|description)\s*(?:is|:)?\s*([^\n]+)$/i) ||
    query.match(/(?:with|using|that has)\s*["“]([^"”]+)["”]/i);

  const rawTitle = titleMatch?.[1]?.trim() ?? titleMatch?.[2]?.trim();
  const title = rawTitle ?? query.slice(0, 60).trim();
  let body = bodyMatch?.[1]?.trim() ?? '';

  if (!body) {
    if (isTask) {
      body = `- [ ] ${query.trim()}`;
    } else if (isMeeting) {
      body = `Meeting notes:\n- Attendees:\n- Agenda:\n- Notes:\n- Action items:`;
    } else if (isSummary) {
      body = `Summary page for: ${query.trim()}`;
    } else {
      body = query.trim();
    }
  }

  const action = isDelete ? 'deletePage' : isPublish ? 'publishPage' : isFormCreation ? 'createDatabase' : 'createPage';
  return {
    title,
    body,
    action,
    useDatabase: explicitDatabase && !isFormCreation,
    template: action === 'createDatabase' ? 'database' : isTask ? 'task' : isMeeting ? 'meeting' : isSummary ? 'summary' : 'doc',
  };
}

function proposeToolCalls(query: string): ToolCall[] {
  const lower = query.toLowerCase();

  // Multi-tool playbook: incident workspace → Slack + Jira + Notion (+ notify)
  if (
    /\b(incident\s+workspace|prepare\s+an?\s+incident|create\s+an?\s+incident\s+workspace)\b/i.test(query) ||
    (/\bincident\b/i.test(query) && /\b(workspace|slack|jira|notion)\b/i.test(query) && /\b(create|prepare|set\s*up)\b/i.test(query))
  ) {
    const summary = query.match(/["“]([^"”]+)["”]/)?.[1] || query.slice(0, 160);
    const channelName = `incident-${Date.now().toString(36).slice(-5)}`;
    const project = process.env.JIRA_DEFAULT_PROJECT || 'KAN';
    const mk = (tool: ToolName, action: string, input: Record<string, unknown>): ToolCall => {
      const requiresApproval = isHighConsequence(tool, action);
      return {
        tool,
        action,
        input,
        riskLevel: requiresApproval ? 'high' : 'low',
        requiresApproval,
      };
    };
    return [
      mk('slack', 'createChannel', { name: channelName, isPrivate: false }),
      mk('jira', 'createIssue', {
        project,
        summary: `Incident: ${summary}`.slice(0, 255),
        description: query,
        issueType: 'Bug',
        priority: 'Highest',
        labels: 'incident,sev',
        sev: 'SEV-1',
        environment: 'production',
      }),
      mk('notion', 'createPage', {
        title: `Incident — ${summary}`.slice(0, 120),
        body: `# Incident\n\n${query}\n\n## Status\nInvestigating\n`,
        template: 'doc',
      }),
      mk('slack', 'postMessage', {
        channel: channelName,
        text: `Incident workspace opened. Tracking in Jira + Notion.\n>${summary}`,
      }),
    ];
  }

  const calls: ToolCall[] = [];
  const slackOnly = isExplicitSlackCommand(query);
  const notionOnly = isExplicitNotionCommand(query) && !slackOnly;

  for (const rule of TOOL_RULES) {
    if (slackOnly && rule.tool !== 'slack') continue;
    if (notionOnly && rule.tool !== 'notion') continue;
    // Never let a Notion URL inside a Slack command select Notion
    if (rule.tool === 'notion' && /https?:\/\/[^\s]*notion/i.test(query) && /\bslack\b/.test(lower)) continue;

    const hitKeyword = rule.keywords.some((k) => {
      if (rule.tool === 'notion' && k === 'notion') {
        // Ignore "notion" that only appears inside URLs
        const stripped = query.replace(/https?:\/\/[^\s]+/gi, ' ').toLowerCase();
        return stripped.includes(k);
      }
      return lower.includes(k);
    });
    const hitMatch = rule.match?.(query) === true;
    if (!hitKeyword && !hitMatch) continue;

    const input = rule.buildInput(query);
    const action = typeof rule.action === 'function' ? rule.action(query) : (input.action as string | undefined) ?? rule.action;
    const requiresApproval = isHighConsequence(rule.tool, action);
    const sanitizedInput = { ...input };
    delete (sanitizedInput as any).action;

    calls.push({
      tool: rule.tool,
      action,
      input: sanitizedInput,
      riskLevel: requiresApproval ? 'high' : 'low',
      requiresApproval,
    });

    // Prefer first high-confidence Jira/read-style hit alone (avoid stacking with Slack createIncident)
    if (rule.tool === 'jira' && (action === 'searchIssues' || action === 'transitionIssue' || action === 'addComment' || action === 'updateIssue' || action === 'linkIssues')) {
      break;
    }
  }
  return calls;
}

function summarizeContext(context: RetrievedContext): string {
  const snippets = context.vectorMatches
    .slice(0, 3)
    .map((m) => `- (${m.metadata.tool ?? 'unknown'}) ${m.text}`)
    .join('\n');
  const relationships = context.graph.edges
    .slice(0, 5)
    .map((e) => `- ${e.from} --[${e.relationship}]--> ${e.to}`)
    .join('\n');
  return [
    snippets ? `Relevant context:\n${snippets}` : 'No directly relevant documents were found.',
    relationships ? `Known relationships:\n${relationships}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function buildPlan(
  query: string,
  intent: ClassifiedIntent,
  context: RetrievedContext,
  llm: LLMClient
): Promise<AgentPlan> {
  const contextSummary = summarizeContext(context);

  const responseDraft = await llm.complete([
    {
      role: 'system',
      content:
        'You are the reasoning engine of an enterprise AI operating system. Answer using only the provided context, and be explicit when a proposed action needs human approval.',
    },
    { role: 'user', content: `Question: ${query}\n\n${contextSummary}` },
  ]);

  const toolCalls = intent.intent === 'action' ? proposeToolCalls(query) : [];

  return {
    intent,
    reasoning: contextSummary,
    toolCalls,
    responseDraft,
  };
}
