import type { AgentPlan, ToolCallResult } from '@enterprise-ai-os/shared';
import { getConnector } from '@enterprise-ai-os/connectors';
import { getApprovalStore } from './approvals';

// ============================================================
// Tool Execution Engine — the other half of the Agent Core box
// in the architecture diagram. Takes the plan's proposed tool
// calls and, for each one:
//   - low/medium risk  -> executes immediately against the
//     connector and records the result
//   - high risk (per HIGH_CONSEQUENCE_ACTIONS, e.g. sending an
//     external email, deleting a record) -> creates a pending
//     approval and does NOT execute until a human approves it
//     via the UI (see apps/web /approvals and apps/api's
//     /approvals routes)
// ============================================================

export interface ExecutionOutcome {
  executedCalls: ToolCallResult[];
  pendingApprovalIds: string[];
}

export async function executePlan(
  organizationId: string,
  plan: AgentPlan,
  requestedByUserId?: string
): Promise<ExecutionOutcome> {
  const executedCalls: ToolCallResult[] = [];
  const pendingApprovalIds: string[] = [];
  const approvalStore = getApprovalStore();

  for (const call of plan.toolCalls) {
    if (call.requiresApproval) {
      const approval = await approvalStore.create(organizationId, call, requestedByUserId);
      pendingApprovalIds.push(approval.id);
      continue;
    }
    const connector = getConnector(call.tool);
    const result = await connector.execute(call.action, call.input);
    executedCalls.push(result);
  }

  return { executedCalls, pendingApprovalIds };
}

/** Called when a human approves a pending action from the approvals inbox. */
export async function executeApprovedAction(approvalId: string): Promise<ToolCallResult | undefined> {
  const approvalStore = getApprovalStore();
  const approval = await approvalStore.get(approvalId);
  if (!approval || approval.status !== 'approved') return undefined;

  const connector = getConnector(approval.tool);
  return connector.execute(approval.action, approval.input);
}
