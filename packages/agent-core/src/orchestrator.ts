import type { AgentTurnResult } from '@enterprise-ai-os/shared';
import type { VectorStore, GraphStore } from '@enterprise-ai-os/stores';
import { classifyIntent } from './intentClassifier';
import { hybridRetrieve } from './retriever';
import { buildPlan } from './planner';
import { executePlan } from './toolExecutionEngine';
import { createLLMClient } from './llmClient';

// ============================================================
// Agent Orchestrator — implements the full loop from the
// architecture doc:
//
//   User Input -> Intent Classifier -> Graph Retrieval / RAG
//              -> LLM Planner -> Tool Call -> Execution Loop
//
// This is the single entry point apps/api's /chat route calls.
// Everything it depends on (LLM client, vector store, graph
// store, connectors) is provided through the shared interfaces
// so each can be swapped for a real backend independently.
// ============================================================

export async function runAgentTurn(
  query: string,
  organizationId: string,
  vectorStore: VectorStore,
  graphStore: GraphStore,
  requestedByUserId?: string
): Promise<AgentTurnResult> {
  const intent = classifyIntent(query);
  const context = await hybridRetrieve(query, organizationId, vectorStore, graphStore);
  const llm = createLLMClient();
  const plan = await buildPlan(query, intent, context, llm);
  const { executedCalls, pendingApprovalIds } = await executePlan(organizationId, plan, requestedByUserId);

  const approvalNote =
    pendingApprovalIds.length > 0
      ? `\n\nNote: ${pendingApprovalIds.length} action(s) require your approval before they run — check the Approvals inbox.`
      : '';

  let reply: string;
  if (executedCalls.length > 0 && pendingApprovalIds.length === 0) {
    reply = executedCalls
      .map((call, idx) => {
        if (call.ok) {
          const output = call.output as Record<string, unknown> | undefined;
          const planned = plan.toolCalls[idx];
          if (call.tool === 'slack' && (call.action === 'postMessage' || call.action === 'postMessageExternalChannel')) {
            const channelName = String(output?.channelName ?? planned?.input?.channel ?? output?.channel ?? 'channel');
            const display = channelName.startsWith('@') ? channelName : `#${channelName.replace(/^#/, '')}`;
            return `Successfully posted to ${display}.`;
          }
          if (call.tool === 'slack' && call.action === 'summarizeChannel') {
            return String(output?.summary ?? 'Channel summary ready.');
          }
          if (call.tool === 'slack' && call.action === 'listChannels') {
            const channels = (output?.channels as Array<{ name?: string }>) ?? [];
            const names = channels
              .slice(0, 15)
              .map((c) => `#${c.name ?? '?'}`)
              .join(', ');
            return `Found ${channels.length} Slack channel(s): ${names}${channels.length > 15 ? '…' : ''}`;
          }
          const url = output?.url ? ` ${output.url}` : '';
          return `✅ ${call.tool}.${call.action} completed successfully.${url}`;
        }
        return `⚠️ ${call.tool}.${call.action} failed: ${call.error ?? 'Unknown error'}`;
      })
      .join('\n');
  } else {
    reply = plan.responseDraft + approvalNote;
  }

  return {
    reply,
    plan,
    executedCalls,
    pendingApprovalIds,
  };
}
