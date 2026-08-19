import type { AgentPlan, AgentTurnResult, ToolCallResult } from '@enterprise-ai-os/shared';
import type { VectorStore, GraphStore } from '@enterprise-ai-os/stores';
import { createLLMClient, type LLMMessage } from '../llmClient';
import { runAgentTurn } from '../orchestrator';
import { recall, listRecentMemory } from '../os/threadMemory';
import { detectOsIntent, isExplicitSlackCommand, isExplicitNotionCommand } from '../os/intentDetector';
import { getConnectorContext, hasSlackTokenInContext, hasNotionTokenInContext, hasJiraTokenInContext, hasGmailTokenInContext } from '@enterprise-ai-os/connectors';

// ============================================================
// Nexora AI Service — single intelligence layer for app + marketing
// ============================================================

export type NexoraTurnMode = 'authenticated' | 'public_marketing';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType?: string;
  text?: string;
  error?: string;
}

export interface NexoraTurnInput {
  message: string;
  organizationId: string;
  userId?: string;
  conversationId?: string;
  mode: NexoraTurnMode;
  history?: ChatHistoryMessage[];
  attachments?: AttachmentMeta[];
  productKnowledge?: string;
  vectorStore?: VectorStore;
  graphStore?: GraphStore;
  /** When true, prefer streaming tokens for general replies */
  stream?: boolean;
}

export type TurnEvent =
  | { type: 'token'; text: string }
  | { type: 'status'; message: string }
  | { type: 'tool_start'; tool: string; action: string }
  | { type: 'tool_result'; tool: string; action: string; ok: boolean; error?: string }
  | { type: 'approval'; ids: string[] }
  | { type: 'done'; result: AgentTurnResult & { conversationId?: string; sources?: string[] } }
  | { type: 'error'; message: string };

const GENERAL_SYSTEM = `You are Nexora AI — a universal assistant inside Nexora OS.

You combine:
1) General intelligence (explain, write, code, debug, plan, analyze, translate, brainstorm)
2) Nexora product expertise when asked about the product
3) Real workspace tools (Slack, Notion, Jira) when the user asks to act on connected apps — but THIS turn may be answer-only; do not invent tool results.

Rules:
- Be clear, accurate, and production-oriented.
- For coding: prefer correct, complete snippets with language fences.
- Never claim you created/posted/saved something unless a tool result is provided in context.
- Never invent current news or live prices; if web search context is missing, say so.
- Distinguish sources: model knowledge vs retrieved workspace vs product docs vs web.
- Respect multi-tenant isolation: only reason about the user's provided context.
- Keep markdown readable (headings, lists, code blocks).`;

const MARKETING_SYSTEM = `You are Nexora Assistant on the public marketing site.

You can answer general questions helpfully AND explain Nexora OS using the product knowledge context.
You cannot execute Slack/Notion/Jira actions from this surface — if the user asks to create channels or pages, explain they should sign in at /app/chat or /register and connect Integrations.
Be honest about live connectors (Slack + Notion primary) vs roadmap logos.
Do not invent pricing or features not in the knowledge context.`;

export function wantsWorkspaceTools(message: string): boolean {
  const q = message.trim();
  if (isExplicitSlackCommand(q) || isExplicitNotionCommand(q)) return true;
  const os = detectOsIntent(q);
  if (os.kind !== 'read_only') return true;
  if (/\b(jira|kan-\d+|create (?:a )?(?:channel|war room|incident|notion|page|issue))\b/i.test(q)) return true;
  if (/\b(post|send|invite|summarize #|find blockers|standup|digest)\b/i.test(q)) return true;
  if (/\b(what happened in|our (?:team|engineering|slack|notion)|workspace)\b/i.test(q)) return true;
  return false;
}

export function wantsProductKnowledge(message: string): boolean {
  return /\b(nexora|ai os|approvals?|integrations?|oauth|what (?:is|does) (?:this|nexora)|pricing|enterprise plan)\b/i.test(
    message
  );
}

export function wantsWebSearch(message: string): boolean {
  return /\b(latest|today|this week|current|news|price of|who won|release notes|what's happening)\b/i.test(message);
}

export async function webSearch(query: string): Promise<{ ok: boolean; summary: string; provider?: string }> {
  const provider = (process.env.WEB_SEARCH_PROVIDER ?? '').toLowerCase().trim();
  const key = process.env.WEB_SEARCH_API_KEY?.trim() || process.env.TAVILY_API_KEY?.trim();
  if (!provider || !key) {
    return {
      ok: false,
      summary:
        'Web search is not configured (set WEB_SEARCH_PROVIDER and WEB_SEARCH_API_KEY). I will not invent current events.',
    };
  }

  try {
    if (provider === 'tavily') {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          query,
          search_depth: 'basic',
          max_results: 5,
        }),
      });
      if (!res.ok) {
        return { ok: false, summary: `Web search failed (${res.status}).`, provider };
      }
      const body = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
        answer?: string;
      };
      const lines = (body.results ?? []).slice(0, 5).map((r, i) => `${i + 1}. ${r.title ?? 'Result'} — ${r.url ?? ''}\n${(r.content ?? '').slice(0, 280)}`);
      return {
        ok: true,
        provider,
        summary: [body.answer ? `Answer: ${body.answer}` : '', ...lines].filter(Boolean).join('\n\n'),
      };
    }

    // Brave / generic stub
    if (provider === 'brave') {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      });
      if (!res.ok) return { ok: false, summary: `Web search failed (${res.status}).`, provider };
      const body = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
      const lines = (body.web?.results ?? []).slice(0, 5).map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${r.description ?? ''}`);
      return { ok: true, provider, summary: lines.join('\n\n') || 'No results.' };
    }

    return { ok: false, summary: `Unknown WEB_SEARCH_PROVIDER="${provider}".`, provider };
  } catch (err) {
    return { ok: false, summary: `Web search error: ${err instanceof Error ? err.message : String(err)}`, provider };
  }
}

export async function buildContextPack(input: NexoraTurnInput): Promise<{
  text: string;
  sources: string[];
  integrations: { slack: boolean; notion: boolean; jira: boolean; gmail: boolean };
}> {
  const sources: string[] = [];
  const parts: string[] = [];
  const integrations = {
    slack: false,
    notion: false,
    jira: false,
    gmail: false,
  };

  try {
    const ctx = getConnectorContext();
    integrations.slack = hasSlackTokenInContext() || Boolean(ctx.slackBotToken);
    integrations.notion = hasNotionTokenInContext() || Boolean(ctx.notionToken);
    integrations.jira = hasJiraTokenInContext() || Boolean(ctx.jiraToken);
    integrations.gmail = hasGmailTokenInContext() || Boolean(ctx.gmailToken);
  } catch {
    // public / no ALS
  }

  if (input.mode === 'authenticated') {
    const gmailAccount = (() => {
      try { const ctx = getConnectorContext(); return ctx.gmailEmail ?? null; } catch { return null; }
    })();
    parts.push(
      `Connected integrations: Slack=${integrations.slack ? 'yes' : 'no'}, Notion=${integrations.notion ? 'yes' : 'no'}, Jira=${integrations.jira ? 'yes' : 'no'}, Gmail=${integrations.gmail ? `yes (${gmailAccount ?? 'connected'})` : 'no'}.`
    );
  }

  if (input.history?.length) {
    const recent = input.history.slice(-12);
    parts.push(
      'Conversation history:\n' +
        recent.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 1200)}`).join('\n')
    );
    sources.push('conversation');
  }

  if (input.mode === 'authenticated' && input.organizationId) {
    try {
      const mem = await listRecentMemory(input.organizationId, 8);
      if (mem.length) {
        parts.push(
          'Workspace memory (recent):\n' +
            mem.map((m) => `- ${m.key}: ${JSON.stringify(m.value).slice(0, 240)}`).join('\n')
        );
        sources.push('agent_memory');
      }
      const latestChannel = await recall(input.organizationId, 'slack:channel:latest');
      if (latestChannel) {
        parts.push(`Last Slack channel memory: ${JSON.stringify(latestChannel)}`);
      }
    } catch {
      // ignore
    }
  }

  if (input.productKnowledge?.trim()) {
    parts.push(`Product knowledge:\n${input.productKnowledge.slice(0, 6000)}`);
    sources.push('product_knowledge');
  }

  if (input.attachments?.length) {
    for (const a of input.attachments) {
      if (a.error) {
        parts.push(`Attachment ${a.filename}: UNAVAILABLE (${a.error}). Do not claim you read this file.`);
      } else if (a.text?.trim()) {
        parts.push(`Attachment ${a.filename} (${a.mimeType ?? 'text'}):\n${a.text.slice(0, 8000)}`);
        sources.push(`file:${a.filename}`);
      } else {
        parts.push(`Attachment ${a.filename}: no extractable text. Do not claim you analyzed it.`);
      }
    }
  }

  if (input.mode === 'authenticated' && wantsWebSearch(input.message)) {
    const web = await webSearch(input.message);
    parts.push(`Web search (${web.provider ?? 'none'}):\n${web.summary}`);
    if (web.ok) sources.push('web');
    else sources.push('web_unavailable');
  }

  return { text: parts.join('\n\n'), sources, integrations };
}

function emptyPlan(reply: string): AgentPlan {
  return {
    intent: { intent: 'read', confidence: 0.9, rationale: 'general_intelligence' },
    reasoning: 'General AI path — no tools required for this turn.',
    toolCalls: [],
    responseDraft: reply,
  };
}

export async function runGeneralIntelligence(
  input: NexoraTurnInput,
  contextText: string,
  onToken?: (t: string) => void
): Promise<string> {
  const llm = createLLMClient();
  const system = input.mode === 'public_marketing' ? MARKETING_SYSTEM : GENERAL_SYSTEM;
  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        contextText ? `Context pack:\n${contextText}` : '',
        `User message:\n${input.message}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  if (onToken || input.stream) {
    let full = '';
    for await (const delta of llm.stream(messages)) {
      full += delta;
      onToken?.(delta);
    }
    return full;
  }
  return llm.complete(messages);
}

/**
 * Unified turn entry. Authenticated tool path uses existing runAgentTurn.
 * General / marketing paths use the LLM gateway with context pack.
 */
export async function runNexoraTurn(input: NexoraTurnInput): Promise<AgentTurnResult & { sources?: string[] }> {
  const pack = await buildContextPack(input);
  const useTools =
    input.mode === 'authenticated' &&
    wantsWorkspaceTools(input.message) &&
    input.vectorStore &&
    input.graphStore;

  if (useTools) {
    // Enrich query with short memory hint for planner (does not dump DB)
    const hint = pack.text.slice(0, 1500);
    const enriched = hint
      ? `${input.message}\n\n[Context for planner — do not invent results]\n${hint}`
      : input.message;
    const result = await runAgentTurn(
      enriched,
      input.organizationId,
      input.vectorStore!,
      input.graphStore!,
      input.userId,
      input.conversationId
    );

    // If planner produced no tools and no approvals, fall through to general AI
    if (result.executedCalls.length === 0 && result.pendingApprovalIds.length === 0) {
      const weak =
        !result.reply ||
        /did not need a tool yet|I understood this as/i.test(result.reply) ||
        result.plan.toolCalls.length === 0;
      if (weak) {
        const reply = await runGeneralIntelligence(input, pack.text);
        return {
          ...result,
          reply,
          plan: { ...result.plan, responseDraft: reply, reasoning: `${result.plan.reasoning}\nFell back to general intelligence.` },
          sources: pack.sources,
        };
      }
    }
    return { ...result, sources: [...pack.sources, 'workspace_tools'] };
  }

  // Product knowledge for marketing or product questions
  const reply = await runGeneralIntelligence(input, pack.text);
  return {
    reply,
    plan: emptyPlan(reply),
    executedCalls: [] as ToolCallResult[],
    pendingApprovalIds: [],
    sources: pack.sources,
  };
}

/** SSE-friendly async generator */
export async function* streamNexoraTurn(input: NexoraTurnInput): AsyncGenerator<TurnEvent> {
  try {
    yield { type: 'status', message: 'Understanding request…' };
    const pack = await buildContextPack(input);
    const useTools =
      input.mode === 'authenticated' &&
      wantsWorkspaceTools(input.message) &&
      input.vectorStore &&
      input.graphStore;

    if (useTools) {
      yield { type: 'status', message: 'Planning workspace actions…' };
      const hint = pack.text.slice(0, 1500);
      const enriched = hint
        ? `${input.message}\n\n[Context for planner — do not invent results]\n${hint}`
        : input.message;
      const result = await runAgentTurn(
        enriched,
        input.organizationId,
        input.vectorStore!,
        input.graphStore!,
        input.userId,
        input.conversationId
      );

      for (const call of result.plan.toolCalls) {
        yield { type: 'tool_start', tool: call.tool, action: call.action };
      }
      for (const call of result.executedCalls) {
        yield {
          type: 'tool_result',
          tool: call.tool,
          action: call.action,
          ok: Boolean(call.ok && !call.mocked),
          error: call.error,
        };
      }
      if (result.pendingApprovalIds.length) {
        yield { type: 'approval', ids: result.pendingApprovalIds };
      }

      const weak =
        result.executedCalls.length === 0 &&
        result.pendingApprovalIds.length === 0 &&
        (result.plan.toolCalls.length === 0 || /did not need a tool yet|I understood this as/i.test(result.reply));

      if (weak) {
        yield { type: 'status', message: 'Answering…' };
        let reply = '';
        for await (const delta of createLLMClient().stream([
          { role: 'system', content: GENERAL_SYSTEM },
          {
            role: 'user',
            content: `${pack.text ? `Context pack:\n${pack.text}\n\n` : ''}User message:\n${input.message}`,
          },
        ])) {
          reply += delta;
          yield { type: 'token', text: delta };
        }
        yield {
          type: 'done',
          result: {
            ...result,
            reply,
            plan: { ...result.plan, responseDraft: reply },
            sources: pack.sources,
          },
        };
        return;
      }

      // Stream the composed tool reply as tokens for UX
      for (const chunk of chunkText(result.reply, 48)) {
        yield { type: 'token', text: chunk };
      }
      yield { type: 'done', result: { ...result, sources: [...pack.sources, 'workspace_tools'] } };
      return;
    }

    yield { type: 'status', message: 'Answering…' };
    let reply = '';
    const system = input.mode === 'public_marketing' ? MARKETING_SYSTEM : GENERAL_SYSTEM;
    for await (const delta of createLLMClient().stream([
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${pack.text ? `Context pack:\n${pack.text}\n\n` : ''}User message:\n${input.message}`,
      },
    ])) {
      reply += delta;
      yield { type: 'token', text: delta };
    }
    yield {
      type: 'done',
      result: {
        reply,
        plan: emptyPlan(reply),
        executedCalls: [],
        pendingApprovalIds: [],
        sources: pack.sources,
      },
    };
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
