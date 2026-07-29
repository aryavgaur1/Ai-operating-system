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
  action: string;
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
    keywords: ['slack', 'post a message', 'notify the team'],
    buildInput: (query) => ({ channel: 'project-phoenix', text: query }),
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
    keywords: ['notion', 'wiki page', 'doc page'],
    buildInput: (query) => ({ title: query.slice(0, 60), content: query }),
  },
];

function proposeToolCalls(query: string): ToolCall[] {
  const lower = query.toLowerCase();
  const calls: ToolCall[] = [];

  for (const rule of TOOL_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      const requiresApproval = isHighConsequence(rule.tool, rule.action);
      calls.push({
        tool: rule.tool,
        action: rule.action,
        input: rule.buildInput(query),
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
