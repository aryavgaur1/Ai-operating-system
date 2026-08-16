import type { AgentPlan, ToolCall, ToolCallResult } from '@enterprise-ai-os/shared';
import {
  getConnector,
  getConnectorContext,
  initializeNotionClient,
  notifyPendingApproval,
  slackService,
} from '@enterprise-ai-os/connectors';
import { logSlackAction } from '@enterprise-ai-os/stores';
import { getApprovalStore } from './approvals';
import { verifyToolResult, preflightToolCall } from './os/preflight';
import { stripCapabilityMeta, validateCapabilityExecution } from './os/capabilityRegistry';
import {
  ApprovalIntegrityError,
  assertApprovalExecutable,
} from './os/approvalIntegrity';

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
      void notifyPendingApproval({
        approvalId: approval.id,
        tool: call.tool,
        action: call.action,
        riskLevel: call.riskLevel,
        summary: JSON.stringify(call.input ?? {}).slice(0, 400),
      });
      continue;
    }
    const gate = validateCapabilityExecution(call);
    if (!gate.ok) {
      executedCalls.push({
        tool: call.tool,
        action: call.action,
        ok: false,
        mocked: false,
        error: gate.message,
      });
      continue;
    }
    const connector = getConnector(call.tool);
    const started = Date.now();
    try {
      const result = await connector.execute(call.action, stripCapabilityMeta(call.input));
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
    if (call.tool === 'jira' && ['createIssue', 'updateIssue', 'transitionIssue', 'addComment'].includes(call.action)) {
      const key = String(output.key ?? call.input?.key ?? call.input?.issueKey ?? '').trim();
      if (!key && call.action !== 'createIssue') return false;
      const checkKey = key || String(output.key ?? '').trim();
      if (!checkKey) return false;
      const ctx = getConnectorContext();
      const token = ctx.jiraToken?.trim();
      const cloudId = ctx.jiraCloudId?.trim();
      if (!token || !cloudId) return false;
      const res = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(checkKey)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        }
      );
      if (!res.ok) return false;
      const body = (await res.json()) as { key?: string; id?: string; fields?: { status?: { name?: string } } };
      if (call.action === 'transitionIssue' && call.input?.status) {
        const want = String(call.input.status).toLowerCase();
        const got = String(body.fields?.status?.name ?? '').toLowerCase();
        return Boolean(body.key === checkKey && (got.includes(want) || want.includes(got)));
      }
      return Boolean(body.key === checkKey || body.id);
    }

    if (call.tool === 'jira' && call.action === 'searchIssues') {
      return Array.isArray(output.results) && typeof output.count === 'number';
    }

    if (call.tool === 'jira' && (call.action === 'listBoards' || call.action === 'listSprints' || call.action === 'getSprintIssues' || call.action === 'linkIssues' || call.action === 'addAttachment')) {
      return output.verified === true || Boolean(output.attachmentId || output.linkType || output.boards || output.sprints || output.issues);
    }

    if (
      call.tool === 'notion' &&
      (call.action === 'createPage' ||
        call.action === 'updatePage' ||
        call.action === 'createDatabaseEntry' ||
        call.action === 'createProject' ||
        call.action === 'createPRD' ||
        call.action === 'createWiki' ||
        call.action === 'createMeetingNotes' ||
        call.action === 'createRoadmap' ||
        call.action === 'createDatabase')
    ) {
      const id = String(output.id ?? '').trim();
      if (!id) return false;
      const client = initializeNotionClient();
      if (call.action === 'createDatabase') {
        const db = await (client.databases as any).retrieve({ database_id: id });
        return Boolean(db?.id);
      }
      const page = await client.pages.retrieve({ page_id: id });
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

    if (call.tool === 'slack' && (call.action === 'createWarRoom' || call.action === 'createIncident')) {
      const channelObj = (output.channel || {}) as { id?: string };
      const id = String(channelObj.id ?? output.id ?? output.channelId ?? '').trim();
      if (!id) return false;
      const info = await slackService.getClient().conversations.info({ channel: id });
      return Boolean((info as any).ok && (info as any).channel?.id);
    }

    if (call.tool === 'slack' && call.action === 'updateMessage') {
      const channel = String(output.channel ?? call.input?.channel ?? '').trim();
      const ts = String(output.ts ?? call.input?.ts ?? '').trim();
      if (!channel || !ts) return false;
      const hist = await slackService.getClient().conversations.history({
        channel,
        latest: ts,
        oldest: ts,
        inclusive: true,
        limit: 1,
      });
      const msg = ((hist as any).messages ?? [])[0];
      if (!msg) return false;
      const want = String(call.input?.text ?? '').trim();
      if (!want) return true;
      return String(msg.text ?? '').includes(want.slice(0, 40));
    }

    if (call.tool === 'slack' && call.action === 'deleteMessage') {
      return output.deleted === true && Boolean(output.ts);
    }

    if (call.tool === 'slack' && call.action === 'inviteUsers') {
      const channel = String(output.channel ?? call.input?.channel ?? '').trim();
      if (!channel) return false;
      const invited = (output.invited as string[] | undefined) ?? [];
      const already = (output.alreadyMembers as string[] | undefined) ?? [];
      const need = [...invited, ...already].filter(Boolean);
      if (!need.length && output.ok === true) {
        return false;
      }
      try {
        const members = await slackService.getClient().conversations.members({ channel, limit: 200 });
        const set = new Set<string>(((members as any).members ?? []) as string[]);
        return need.length > 0 && need.every((id) => set.has(id));
      } catch {
        return false;
      }
    }

    if (call.tool === 'slack' && (call.action === 'searchHistory' || call.action === 'searchMessages')) {
      return Array.isArray(output.matches) || typeof output.count === 'number' || Array.isArray(output.messages);
    }

    if (call.tool === 'slack' && call.action === 'openDm') {
      const channel = String(output.channel ?? '').trim();
      if (!channel) return false;
      const info = await slackService.getClient().conversations.info({ channel });
      return Boolean((info as any).ok && (info as any).channel?.id);
    }

    if (call.tool === 'slack' && call.action === 'joinChannel') {
      const id = String(output.id ?? output.channel ?? '').trim();
      if (!id) return false;
      const info = await slackService.getClient().conversations.info({ channel: id });
      return Boolean((info as any).ok && (info as any).channel?.is_member !== false);
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
 * Integrity gate runs BEFORE any connector call.
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

  // P0.3 integrity — ZERO connector calls on failure
  try {
    assertApprovalExecutable(approval);
  } catch (err) {
    const code = err instanceof ApprovalIntegrityError ? err.code : 'APPROVAL_INVALID_STATE';
    const message = err instanceof Error ? err.message : 'Approval integrity check failed';
    const failed: ToolCallResult = {
      tool: approval.tool,
      action: approval.action,
      ok: false,
      mocked: false,
      error: `${code}: ${message}`,
    };
    await auditSlack(approval.action, approval.input ?? {}, failed, Date.now(), 'approval_integrity');
    await approvalStore.completeExecution(approvalId, failed, false);
    return failed;
  }

  const call: ToolCall = {
    tool: approval.tool,
    action: approval.action,
    input: approval.input ?? {},
    riskLevel: approval.riskLevel,
    requiresApproval: false,
  };

  // Capability boundary — reject cross-scope / unknown even after Approve & run
  const gate = validateCapabilityExecution(call);
  if (!gate.ok) {
    const failed: ToolCallResult = {
      tool: call.tool,
      action: call.action,
      ok: false,
      mocked: false,
      error: gate.message,
    };
    await auditSlack(approval.action, approval.input ?? {}, failed, Date.now(), 'capability_gate');
    await approvalStore.completeExecution(approvalId, failed, false);
    return failed;
  }

  // Re-validate connection / project / channel / parent right before live execute
  const pf = await preflightToolCall(call);
  if (!pf.ok) {
    const failed: ToolCallResult = {
      tool: call.tool,
      action: call.action,
      ok: false,
      mocked: false,
      error: pf.fatal || `Preflight failed for ${call.tool}.${call.action}`,
    };
    await auditSlack(approval.action, approval.input ?? {}, failed, Date.now(), 'approved_action_preflight');
    await approvalStore.completeExecution(approvalId, failed, false);
    return failed;
  }
  // Keep capability stamps from the approved snapshot; merge preflight heals
  call.input = {
    ...pf.input,
    _intentFamily: call.input._intentFamily,
    _capabilityScope: call.input._capabilityScope,
    _lockedCapability: call.input._lockedCapability,
  };

  // Re-check fingerprint against ORIGINAL approved snapshot (not healed view)
  try {
    assertApprovalExecutable(approval);
  } catch (err) {
    const code = err instanceof ApprovalIntegrityError ? err.code : 'APPROVAL_PAYLOAD_CHANGED';
    const message = err instanceof Error ? err.message : 'Approval integrity failed after preflight';
    const failed: ToolCallResult = {
      tool: call.tool,
      action: call.action,
      ok: false,
      mocked: false,
      error: `${code}: ${message}`,
    };
    await approvalStore.completeExecution(approvalId, failed, false);
    return failed;
  }

  const connector = getConnector(approval.tool);
  const started = Date.now();
  let result: ToolCallResult;
  try {
    result = await connector.execute(approval.action, stripCapabilityMeta(call.input));
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
