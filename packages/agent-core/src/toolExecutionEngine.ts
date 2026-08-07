import type { AgentPlan, ToolCallResult } from '@enterprise-ai-os/shared';
import { getConnector, getConnectorContext } from '@enterprise-ai-os/connectors';
import { logSlackAction } from '@enterprise-ai-os/stores';
import { getApprovalStore } from './approvals';

// ============================================================
// Tool Execution Engine — executes planned tool calls with
// approval gating + Slack action audit logging.
// ============================================================

export interface ExecutionOutcome {
  executedCalls: ToolCallResult[];
  pendingApprovalIds: string[];
}

async function auditSlack(
  action: string,
  input: Record<string, unknown>,
  result: ToolCallResult,
  started: number,
  reason?: string
) {
  if (result.tool !== 'slack') return;
  const ctx = getConnectorContext();
  await logSlackAction({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action,
    payload: { input, reason: reason ?? 'agent_chat', output: result.ok ? result.output : undefined },
    status: result.ok ? 'ok' : 'error',
    error: result.error,
    executionTimeMs: Date.now() - started,
  });
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
    const started = Date.now();
    try {
      const result = await connector.execute(call.action, call.input);
      executedCalls.push(result);
      await auditSlack(call.action, call.input, result, started, plan.reasoning?.slice(0, 500));
    } catch (err) {
      const result: ToolCallResult = {
        tool: call.tool,
        action: call.action,
        ok: false,
        error: err instanceof Error ? err.message : 'Tool execution failed',
        mocked: false,
      };
      executedCalls.push(result);
      await auditSlack(call.action, call.input, result, started, plan.reasoning?.slice(0, 500));
    }
  }

  return { executedCalls, pendingApprovalIds };
}

/** Called when a human approves a pending action from the approvals inbox. */
export async function executeApprovedAction(approvalId: string): Promise<ToolCallResult | undefined> {
  const approvalStore = getApprovalStore();
  const approval = await approvalStore.get(approvalId);
  if (!approval || approval.status !== 'approved') return undefined;

  const connector = getConnector(approval.tool);
  const started = Date.now();
  const result = await connector.execute(approval.action, approval.input);
  await auditSlack(approval.action, approval.input, result, started, 'approved_action');
  return result;
}
