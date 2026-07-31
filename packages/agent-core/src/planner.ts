import type { AgentPlan, ClassifiedIntent, RetrievedContext, ToolCall, ToolName } from '@enterprise-ai-os/shared';
import { isHighConsequence } from '@enterprise-ai-os/shared';
import type { LLMClient } from './llmClient';

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
}

const TOOL_RULES: ToolRule[] = [
  {
    tool: 'gmail',
    action: 'sendEmail',
    keywords: ['email', 'send an email', 'mail'],
    buildInput: (query) => ({
      to: 'client@example.com',
      subject: 'Update on your project',
      body: `Drafted in response to: "${query}"`,
    }),
  },
  {
    tool: 'jira',
    action: 'createIssue',
    keywords: ['jira', 'ticket', 'issue', 'task'],
    buildInput: (query) => ({
      project: 'PHX',
      summary: query.slice(0, 100),
      description: query,
    }),
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
      'summarize channel',
      'summarise channel',
      'upload to slack',
      'upload file',
      'react on slack',
      'add reaction',
      'create channel',
      'invite to',
    ],
    buildInput: (query) => parseSlackActionQuery(query),
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
  if (/\b(summarize|summarise|recap)\b/.test(lower) && /\b(channel|slack|#)/.test(lower)) {
    return { action: 'summarizeChannel', channel, limit: 30 };
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
  if (/\b(create)\b/.test(lower) && /\b(channel)\b/.test(lower)) {
    const name =
      quoted ??
      query.match(/channel\s+(?:called|named)?\s*[#\"']?([a-z0-9_-]+)/i)?.[1] ??
      channel;
    return { action: 'createChannel', name };
  }
  if (/\b(invite)\b/.test(lower)) {
    const users = query.match(/\b(U[A-Z0-9]+)\b/g) ?? [];
    return { action: 'inviteUsers', channel, users };
  }

  // Default: post a message. Prefer quoted text; otherwise strip the routing preamble.
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
  const calls: ToolCall[] = [];

  for (const rule of TOOL_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
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
