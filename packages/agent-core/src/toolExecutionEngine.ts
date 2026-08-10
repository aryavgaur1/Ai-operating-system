import type { AgentPlan, ToolCall, ToolCallResult } from '@enterprise-ai-os/shared';
import {
  getConnector,
  getConnectorContext,
  initializeNotionClient,
  slackService,
} from '@enterprise-ai-os/connectors';
import { logSlackAction } from '@enterprise-ai-os/stores';
import { getApprovalStore } from './approvals';
import { verifyToolResult } from './os/preflight';

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

/**
 * External confirmation after a live connector returns ok.
 * HTTP 200 / connector ok alone is not enough — confirm the object exists.
 */
async function confirmExternalObject(call: ToolCall, result: ToolCallResult): Promise<boolean> {
  if (!result.ok || result.mocked) return false;
  const output = (result.output || {}) as Record<string, unknown>;

  try {
    if (call.tool === 'jira' && call.action === 'createIssue') {
      const key = String(output.key ?? '').trim();
      if (!key) return false;
      const ctx = getConnectorContext();
      const token = ctx.jiraToken?.trim();
      const cloudId = ctx.jiraCloudId?.trim();
      if (!token || !cloudId) return false;
      const res = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(key)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        }
      );
      if (!res.ok) return false;
      const body = (await res.json()) as { key?: string; id?: string };
      return Boolean(body.key === key || body.id);
    }

    if (
      call.tool === 'notion' &&
      (call.action === 'createPage' ||
        call.action === 'createProject' ||
        call.action === 'createPRD' ||
        call.action === 'createWiki' ||
        call.action === 'createMeetingNotes' ||
        call.action === 'createDatabase')
    ) {
      const id = String(output.id ?? '').trim();
      if (!id) return false;
      const page = await initializeNotionClient().pages.retrieve({ page_id: id });
      return Boolean((page as any)?.id);
    }

    if (call.tool === 'slack' && (call.action === 'postMessage' || call.action === 'postMessageExternalChannel')) {
      const channel = String(output.channel ?? '').trim();
      const ts = String(output.ts ?? '').trim();
      if (!channel || !ts) return false;
      const hist = await slackService.getClient().conversations.history({
        channel,
        latest: ts,
        oldest: ts,
        inclusive: true,
        limit: 1,
      });
      return Boolean((hist as any).ok && Array.isArray((hist as any).messages) && (hist as any).messages.length > 0);
    }

    if (call.tool === 'slack' && call.action === 'createChannel') {
      const id = String(output.id ?? '').trim();
      if (!id) return false;
      const info = await slackService.getClient().conversations.info({ channel: id });
      return Boolean((info as any).ok && (info as any).channel?.id);
    }

    // Fallback: structural verify (ts / id / key present) via shared preflight helper
    return verifyToolResult(call, result);
  } catch {
    return false;
  }
}

function rejectMockOrUnverified(result: ToolCallResult, verified: boolean): ToolCallResult {
  if (result.mocked) {
    return {
      ...result,
      ok: false,
      error:
        result.error ||
        `Refusing mock success for ${result.tool}.${result.action} — connect the live integration and retry.`,
    };
  }
  if (result.ok && !verified) {
    return {
      ...result,
      ok: false,
      error: `External verification failed for ${result.tool}.${result.action} — the tool reported success but the object could not be confirmed.`,
    };
  }
  return result;
}

/**
 * Called when a human approves a pending action from the approvals inbox / chat.
 * Uses ONLY the stored approval input — never invents params from the client.
 */
export async function executeApprovedAction(approvalId: string): Promise<ToolCallResult | undefined> {
  const approvalStore = getApprovalStore();
  const approval = await approvalStore.get(approvalId);
  if (!approval) return undefined;

  // Idempotent replay: already finished with a stored result
  if (approval.executionResult && (approval.executionStatus === 'completed' || approval.executionStatus === 'failed')) {
    return approval.executionResult;
  }

  if (approval.status !== 'approved' || approval.executionStatus !== 'executing') {
    return undefined;
  }

  const call: ToolCall = {
    tool: approval.tool,
    action: approval.action,
    input: approval.input ?? {},
    riskLevel: approval.riskLevel,
    requiresApproval: false,
  };

  const connector = getConnector(approval.tool);
  const started = Date.now();
  let result: ToolCallResult;
  try {
    result = await connector.execute(approval.action, approval.input ?? {});
  } catch (err) {
    result = {
      tool: approval.tool,
      action: approval.action,
      ok: false,
      error: err instanceof Error ? err.message : 'Tool execution failed',
      mocked: false,
    };
  }

  let verified = false;
  if (result.ok && !result.mocked) {
    verified = await confirmExternalObject(call, result);
  }
  result = rejectMockOrUnverified(result, verified);

  await auditSlack(approval.action, approval.input ?? {}, result, started, 'approved_action');
  await approvalStore.completeExecution(approvalId, result, verified && result.ok && !result.mocked);
  return result;
}
