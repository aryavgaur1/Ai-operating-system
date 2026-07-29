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

  return {
    reply: plan.responseDraft + approvalNote,
    plan,
    executedCalls,
    pendingApprovalIds,
  };
}
