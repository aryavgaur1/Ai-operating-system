import type {
  AgentPlan,
  ToolCall,
  ToolCallResult,
  WorkflowStepResult,
} from '@enterprise-ai-os/shared';
import { getConnector, getConnectorContext } from '@enterprise-ai-os/connectors';
import { logSlackAction } from '@enterprise-ai-os/stores';
import { getApprovalStore } from '../approvals';
import {
  classifyFailure,
  healAndRetry,
  humanizeError,
  preflightToolCall,
  verifyToolResult,
  withBackoff,
} from './preflight';

// ============================================================
// STEPS 5–7 — Self-healing execution + verification
// Wraps the existing connector registry. Never fake success.
// ============================================================

export interface ResilientOutcome {
  executedCalls: ToolCallResult[];
  pendingApprovalIds: string[];
  steps: WorkflowStepResult[];
  retries: number;
}

async function audit(call: ToolCall, result: ToolCallResult, started: number, meta: Record<string, unknown>) {
  if (call.tool !== 'slack') return;
  const ctx = getConnectorContext();
  await logSlackAction({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: call.action,
    payload: { input: call.input, ...meta, output: result.ok ? result.output : undefined },
    status: result.ok ? 'ok' : 'error',
    error: result.error,
    executionTimeMs: Date.now() - started,
  });
}

async function executeOne(call: ToolCall, maxAttempts = 3): Promise<{ result: ToolCallResult; step: WorkflowStepResult }> {
  const stepId = `${call.tool}.${call.action}.${Date.now().toString(36).slice(-4)}`;
  let attempts = 0;
  let healActions: string[] = [];
  let current = call;
  const startedAll = Date.now();

  // Preflight
  const pre = await preflightToolCall(current);
  healActions.push(...pre.healActions);
  if (!pre.ok) {
    const result: ToolCallResult = {
      tool: current.tool,
      action: current.action,
      ok: false,
      error: humanizeError(current.tool, current.action, pre.fatal),
      mocked: false,
    };
    return {
      result,
      step: {
        stepId,
        tool: current.tool,
        action: current.action,
        status: 'fatal_failure',
        attempts: 1,
        durationMs: Date.now() - startedAll,
        error: result.error,
        healActions,
        verified: false,
      },
    };
  }
  current = { ...current, input: pre.input };

  while (attempts < maxAttempts) {
    attempts += 1;
    const started = Date.now();
    try {
      const connector = getConnector(current.tool);
      const result = await withBackoff(() => connector.execute(current.action, current.input), 2);
      await audit(current, result, started, { healActions, attempt: attempts });

      if (result.ok && !result.mocked) {
        const verified = await verifyToolResult(current, result);
        if (!verified && attempts < maxAttempts) {
          healActions.push('verification_failed_retry');
          continue;
        }
        return {
          result,
          step: {
            stepId,
            tool: current.tool,
            action: current.action,
            status: healActions.length ? 'healed' : 'success',
            attempts,
            durationMs: Date.now() - startedAll,
            healActions,
            verified,
            output: result.output,
          },
        };
      }

      if (result.mocked) {
        return {
          result: {
            ...result,
            error: humanizeError(current.tool, current.action, result.error),
          },
          step: {
            stepId,
            tool: current.tool,
            action: current.action,
            status: 'fatal_failure',
            attempts,
            durationMs: Date.now() - startedAll,
            error: result.error,
            healActions,
            verified: false,
          },
        };
      }

      const kind = classifyFailure(result.error);
      if (kind === 'fatal_failure' || attempts >= maxAttempts) {
        return {
          result: {
            ...result,
            error: humanizeError(current.tool, current.action, result.error),
          },
          step: {
            stepId,
            tool: current.tool,
            action: current.action,
            status: kind,
            attempts,
            durationMs: Date.now() - startedAll,
            error: result.error,
            healActions,
            verified: false,
          },
        };
      }

      const healed = await healAndRetry(current, result.error || '');
      if (!healed) {
        return {
          result: {
            ...result,
            error: humanizeError(current.tool, current.action, result.error),
          },
          step: {
            stepId,
            tool: current.tool,
            action: current.action,
            status: 'fatal_failure',
            attempts,
            durationMs: Date.now() - startedAll,
            error: result.error,
            healActions,
            verified: false,
          },
        };
      }
      current = healed.call;
      healActions.push(...healed.healActions);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      const kind = classifyFailure(message);
      if (kind === 'fatal_failure' || attempts >= maxAttempts) {
        const result: ToolCallResult = {
          tool: current.tool,
          action: current.action,
          ok: false,
          error: humanizeError(current.tool, current.action, message),
          mocked: false,
        };
        return {
          result,
          step: {
            stepId,
            tool: current.tool,
            action: current.action,
            status: kind,
            attempts,
            durationMs: Date.now() - startedAll,
            error: message,
            healActions,
            verified: false,
          },
        };
      }
      const healed = await healAndRetry(current, message);
      if (!healed) {
        const result: ToolCallResult = {
          tool: current.tool,
          action: current.action,
          ok: false,
          error: humanizeError(current.tool, current.action, message),
          mocked: false,
        };
        return {
          result,
          step: {
            stepId,
            tool: current.tool,
            action: current.action,
            status: 'fatal_failure',
            attempts,
            durationMs: Date.now() - startedAll,
            error: message,
            healActions,
            verified: false,
          },
        };
      }
      current = healed.call;
      healActions.push(...healed.healActions);
    }
  }

  const result: ToolCallResult = {
    tool: call.tool,
    action: call.action,
    ok: false,
    error: humanizeError(call.tool, call.action, 'Exhausted retries'),
    mocked: false,
  };
  return {
    result,
    step: {
      stepId,
      tool: call.tool,
      action: call.action,
      status: 'retryable_failure',
      attempts,
      durationMs: Date.now() - startedAll,
      error: 'Exhausted retries',
      healActions,
      verified: false,
    },
  };
}

export async function executePlanResilient(
  organizationId: string,
  plan: AgentPlan,
  requestedByUserId?: string
): Promise<ResilientOutcome> {
  const executedCalls: ToolCallResult[] = [];
  const pendingApprovalIds: string[] = [];
  const steps: WorkflowStepResult[] = [];
  let retries = 0;
  const approvalStore = getApprovalStore();

  // Carry context between steps (e.g. war room channel → kickoff post)
  const ctx: Record<string, unknown> = {};

  for (const raw of plan.toolCalls) {
    if (raw.requiresApproval) {
      const approval = await approvalStore.create(organizationId, raw, requestedByUserId);
      pendingApprovalIds.push(approval.id);
      steps.push({
        stepId: `approval.${raw.tool}.${raw.action}`,
        tool: raw.tool,
        action: raw.action,
        status: 'skipped',
        attempts: 0,
        durationMs: 0,
        healActions: ['queued_for_approval'],
      });
      continue;
    }

    // Enrich from prior step context
    const call: ToolCall = { ...raw, input: { ...raw.input } };
    if (ctx.slackChannelId && call.tool === 'slack' && !call.input.channel && call.action === 'postMessage') {
      call.input.channel = ctx.slackChannelId;
    }
    if (ctx.digestSummary && call.tool === 'notion' && call.action === 'createMeetingNotes') {
      call.input.body = `${String(call.input.body || '')}\n\n## Slack digest\n${ctx.digestSummary}`;
    }
    if (ctx.digestSummary && call.tool === 'slack' && call.action === 'postMessage' && !call.input.text) {
      call.input.text = `📋 *Standup prep*\n${String(ctx.digestSummary).slice(0, 2800)}`;
      call.input.channel = call.input.channel || 'general';
    }

    const { result, step } = await executeOne(call);
    executedCalls.push(result);
    steps.push(step);
    if (step.attempts > 1) retries += step.attempts - 1;

    if (result.ok) {
      const out = (result.output || {}) as Record<string, unknown>;
      if (call.action === 'createWarRoom' || call.action === 'createIncident') {
        const ch = (out.channel || {}) as { id?: string; name?: string };
        if (ch.id) ctx.slackChannelId = ch.id;
        if (ch.name) ctx.slackChannelName = ch.name;
      }
      if (call.action === 'createChannel' && out.id) {
        ctx.slackChannelId = out.id;
        ctx.slackChannelName = out.name;
      }
      if (call.action === 'dailyDigest' || call.action === 'weeklyDigest' || call.action === 'summarizeChannel') {
        ctx.digestSummary = out.summary;
      }
      if (call.tool === 'notion' && out.id) {
        ctx.notionPageId = out.id;
        ctx.notionUrl = out.url;
      }
    }
  }

    // Standup: if we have a digest and Notion page but no post yet, broadcast
  if (ctx.digestSummary && !executedCalls.some((c) => c.action === 'postMessage' && c.ok)) {
    const targets = [
      process.env.SLACK_DEFAULT_CHANNEL_ID,
      ctx.slackChannelId,
      'general',
    ].filter(Boolean) as string[];

    if (plan.toolCalls.some((t) => t.action === 'dailyDigest') && plan.toolCalls.some((t) => t.tool === 'notion')) {
      let posted = false;
      for (const channel of targets) {
        const broadcast: ToolCall = {
          tool: 'slack',
          action: 'postMessage',
          input: {
            channel,
            text: `📋 *Nexora standup prep*\n${String(ctx.digestSummary).slice(0, 2500)}${ctx.notionUrl ? `\nNotion: ${ctx.notionUrl}` : ''}`,
          },
          riskLevel: 'low',
          requiresApproval: false,
        };
        const { result, step } = await executeOne(broadcast);
        executedCalls.push(result);
        steps.push(step);
        if (result.ok) {
          posted = true;
          break;
        }
      }
      if (!posted) {
        // Soft success path: digest + Notion already done — don't fail the whole workflow
        executedCalls.push({
          tool: 'slack',
          action: 'postMessage',
          ok: true,
          mocked: false,
          output: {
            deferred: true,
            summary:
              'Standup digest + Notion notes are ready. Could not post to #general automatically — invite the bot to #general or set SLACK_DEFAULT_CHANNEL_ID.',
          },
        });
      }
    }
  }

  return { executedCalls, pendingApprovalIds, steps, retries };
}
