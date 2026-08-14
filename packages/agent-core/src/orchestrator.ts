import type { AgentPlan, AgentTurnResult, ClassifiedIntent, ToolName } from '@enterprise-ai-os/shared';
import type { VectorStore, GraphStore } from '@enterprise-ai-os/stores';
import { classifyIntent } from './intentClassifier';
import { hybridRetrieve } from './retriever';
import { buildPlan } from './planner';
import { createLLMClient } from './llmClient';
import {
  planWorkflow,
  executePlanResilient,
  rememberFromExecution,
  logWorkflow,
  resolveAuthoritativeRoute,
  filterToolCallsByFamily,
  toolCallFromRoute,
  buildDecisionRecord,
  clarifyReplyForJira,
  cancelReply,
  dryRunReplyForPlan,
} from './os';

// ============================================================
// Agent Orchestrator — Enterprise AI OS execution loop
//
//   Prompt → Intent → Planner → Policy filter → Execute/Approve
//        → Verify → Heal/Retry → Reply + Decision record
// ============================================================

function formatReply(executedCalls: AgentTurnResult['executedCalls'], plan: AgentPlan, approvalNote: string): string {
  if (executedCalls.length === 0) {
    if (approvalNote) {
      const pending = plan.toolCalls.filter((c) => c.requiresApproval);
      if (pending.length > 0) {
        const lines = pending.map(
          (c) => `• **${c.tool}.${c.action}** (${c.riskLevel} risk) — queued for human approval`
        );
        return (
          `I prepared ${pending.length} high-impact action(s) and paused them for your review:\n\n` +
          lines.join('\n') +
          `\n\nOpen **Approvals** → **Approve & run** to execute (or reject).` +
          approvalNote
        );
      }
    }
    return plan.responseDraft + approvalNote;
  }

  const lines = executedCalls.map((call, idx) => {
    if (call.mocked) {
      return `Not connected / not live: ${call.tool}.${call.action}. ${call.error ?? 'Connect a live integration under Integrations, then ask again.'}`;
    }
    if (!call.ok) {
      const err = call.error ?? 'still blocked';
      if (/^Not (connected|implemented)/i.test(err)) {
        return err;
      }
      return `I tried ${call.tool}.${call.action} and self-healed where possible — ${err}.`;
    }

    const output = call.output as Record<string, unknown> | undefined;
    const planned = plan.toolCalls[idx];

    if (call.tool === 'slack' && call.action === 'createChannel') {
      const name = String(output?.name ?? planned?.input?.name ?? 'channel');
      const id = output?.id ? ` (id: ${output.id})` : '';
      const url = output?.url ? `\nOpen: ${output.url}` : '';
      if (output?.reused) return `✅ Slack channel #${name} already existed — reused it${id}.${url}`;
      return `✅ Slack channel #${name} created successfully${id}.${url}`;
    }
    if (call.tool === 'slack' && (call.action === 'postMessage' || call.action === 'postMessageExternalChannel')) {
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? output?.channel ?? 'channel');
      const display = channelName.startsWith('@') ? channelName : `#${channelName.replace(/^#/, '')}`;
      const ts = output?.ts ? ` (ts: ${output.ts})` : '';
      return `✅ Posted to ${display}${ts}.`;
    }
    if (call.tool === 'slack' && call.action === 'listChannels') {
      const channels = (output?.channels as Array<{ name?: string }>) ?? [];
      const names = channels
        .slice(0, 15)
        .map((c) => `#${c.name ?? '?'}`)
        .join(', ');
      return `Found ${channels.length} Slack channel(s): ${names}${channels.length > 15 ? '…' : ''}`;
    }
    if (call.tool === 'slack' && call.action === 'listUsers') {
      const users = (output?.users as Array<{ name?: string; real_name?: string; display_name?: string }>) ?? [];
      const names = users
        .slice(0, 15)
        .map((u) => u.real_name || u.display_name || u.name || '?')
        .join(', ');
      return `Found ${users.length} Slack user(s): ${names}${users.length > 15 ? '…' : ''}`;
    }
    if (call.tool === 'slack' && call.action === 'inviteUsers') {
      const invited = (output?.invited as string[]) ?? (output?.users as string[]) ?? [];
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `✅ Invited ${invited.length || 'member(s)'} to #${channelName}.`;
    }
    if (call.tool === 'slack' && call.action === 'getChannelHistory') {
      const messages = (output?.messages as unknown[]) ?? [];
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `Fetched ${messages.length} message(s) from #${channelName}.`;
    }
    if (call.tool === 'slack' && call.action === 'searchHistory') {
      const matches = (output?.matches as unknown[]) ?? (output?.messages as unknown[]) ?? [];
      return `Found ${matches.length} Slack search match(es) for “${String(planned?.input?.query ?? '')}”.`;
    }
    if (call.tool === 'slack' && call.action === 'setChannelTopic') {
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `✅ Set topic on #${channelName} to “${String(planned?.input?.topic ?? output?.topic ?? '')}”.`;
    }
    if (call.tool === 'slack' && call.action === 'createBookmark') {
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `✅ Bookmarked ${String(planned?.input?.url ?? output?.url ?? 'link')} in #${channelName}.`;
    }
    if (call.tool === 'slack' && call.action === 'createCanvas') {
      const title = String(output?.title ?? planned?.input?.title ?? 'Canvas');
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `✅ Created canvas “${title}” in #${channelName}.`;
    }
    if (
      call.tool === 'slack' &&
      [
        'createWarRoom',
        'createIncident',
        'findBlockers',
        'findUnansweredMessages',
        'findCustomerComplaints',
        'detectActionItems',
        'followUpPendingReplies',
        'dailyDigest',
        'weeklyDigest',
        'semanticSearch',
        'detectDeadChannels',
        'findDecision',
        'findOwner',
        'summarizeThread',
        'summarizeChannel',
        'generateMeetingNotes',
      ].includes(call.action)
    ) {
      return String(output?.summary ?? `✅ slack.${call.action} completed.`);
    }
    if (call.tool === 'notion') {
      const url = output?.url ? ` ${output.url}` : '';
      const id = output?.id ? ` (id: ${output.id})` : '';
      if (call.action === 'searchPages') {
        const results = (output?.results as unknown[]) ?? [];
        return `Found ${results.length} Notion page(s).`;
      }
      return `✅ Notion ${call.action} completed${id}.${url}`;
    }
    const url = output?.url ? ` ${output.url}` : '';
    return `✅ ${call.tool}.${call.action} completed.${url}`;
  });

  return lines.join('\n') + approvalNote;
}

export async function runAgentTurn(
  query: string,
  organizationId: string,
  vectorStore: VectorStore,
  graphStore: GraphStore,
  requestedByUserId?: string
): Promise<AgentTurnResult> {
  const started = Date.now();

  // ONE authoritative decision for the entire turn
  const route = resolveAuthoritativeRoute(query);
  const osIntent = route.osIntent;
  const requestMode = route.mode;
  const intentFamily = route.family;
  const legacyIntent: ClassifiedIntent =
    osIntent.kind === 'read_only' && !route.lockedTool
      ? classifyIntent(query)
      : {
          intent: osIntent.legacyIntent === 'read' && route.lockedTool ? 'action' : osIntent.legacyIntent,
          confidence: route.confidence,
          rationale: route.rationale,
        };

  const context = await hybridRetrieve(query, organizationId, vectorStore, graphStore);
  const llm = createLLMClient();
  const reasoning: string[] = [
    `Authoritative route: family=${route.family} mode=${route.mode} tool=${route.lockedTool ?? '—'} action=${route.lockedAction ?? '—'} ambiguous=${route.ambiguous}`,
    route.rationale,
  ];

  const emptyDecision = (selected: AgentPlan['toolCalls'] = [], stripped: Array<{ tool: ToolName; action: string; reason: string }> = []) =>
    buildDecisionRecord({
      query,
      intent: osIntent,
      family: intentFamily,
      mode: requestMode,
      selected,
      stripped,
      pendingApprovalIds: [],
      executedCount: 0,
      route,
    });

  if (requestMode === 'cancel') {
    const reply = cancelReply();
    return {
      reply,
      plan: { intent: legacyIntent, reasoning: 'Cancelled by user request.', toolCalls: [], responseDraft: reply },
      executedCalls: [],
      pendingApprovalIds: [],
      workflow: {
        intent: osIntent,
        reasoning: [...reasoning, 'Cancel — no tools.'],
        planSteps: [],
        steps: [],
        retries: 0,
        durationMs: Date.now() - started,
        decision: emptyDecision(),
      },
    };
  }

  if (requestMode === 'clarify' || route.ambiguous) {
    const reply =
      route.clarifyMessage ||
      (/\b(jira|ticket|vendor)\b/i.test(query)
        ? clarifyReplyForJira(query)
        : `I’m not executing anything yet. Tell me the system (Jira / Slack / Notion) and the exact action.`);
    return {
      reply,
      plan: {
        intent: legacyIntent,
        reasoning: 'Clarify / ambiguous — no tools.',
        toolCalls: [],
        responseDraft: reply,
      },
      executedCalls: [],
      pendingApprovalIds: [],
      workflow: {
        intent: osIntent,
        reasoning: [...reasoning, 'Clarify — no tools.'],
        planSteps: [],
        steps: [],
        retries: 0,
        durationMs: Date.now() - started,
        decision: emptyDecision(),
      },
    };
  }

  let plan: AgentPlan;
  let strippedTools: Array<{ tool: ToolName; action: string; reason: string }> = [];
  const planSteps: string[] = [];

  // Workflows only when route.allowWorkflow
  const workflow = route.allowWorkflow
    ? planWorkflow(query, osIntent)
    : { reasoning: ['Workflow planner skipped — authoritative route forbids multi-step workflow.'], planSteps: [] as string[], toolCalls: [] as AgentPlan['toolCalls'] };

  if (!route.allowWorkflow && workflow.toolCalls.length === 0) {
    reasoning.push('Workflow skipped by authoritative route.');
  }

  if (route.allowWorkflow && workflow.toolCalls.length > 0) {
    const draft = await llm.complete([
      {
        role: 'system',
        content:
          'You are the reasoning engine of an enterprise AI operating system. Briefly confirm the workflow you will execute. Do not invent tool results.',
      },
      {
        role: 'user',
        content: `User: ${query}\n\nPlan:\n${workflow.planSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nReasoning:\n${workflow.reasoning.join('\n')}`,
      },
    ]);
    plan = {
      intent: legacyIntent,
      reasoning: [...workflow.reasoning, draft].join('\n'),
      toolCalls: workflow.toolCalls,
      responseDraft: draft,
    };
    reasoning.push(...workflow.reasoning);
  } else {
    // Prefer locked tool call from route; planner only fills within family
    const locked = toolCallFromRoute(route, query);
    if (locked && route.lockedAction) {
      plan = {
        intent: { ...legacyIntent, intent: 'action' },
        reasoning: `Locked by authoritative route: ${locked.tool}.${locked.action}`,
        toolCalls: [locked],
        responseDraft: `Prepared ${locked.tool}.${locked.action} for review.`,
      };
    } else {
      plan = await buildPlan(
        query,
        legacyIntent.intent === 'action' ? legacyIntent : { ...legacyIntent, intent: 'action' },
        context,
        llm,
        route
      );
    }
    reasoning.push('Single-tool path under authoritative route.');
  }

  const filtered = filterToolCallsByFamily(plan.toolCalls, intentFamily, route);
  if (filtered.stripped.length) {
    strippedTools = [...strippedTools, ...filtered.stripped];
    reasoning.push(`Policy stripped ${filtered.stripped.length} tool(s).`);
  }
  plan.toolCalls = filtered.kept;

  // If lock exists but filter emptied, rebuild from lock
  if (route.lockedTool && route.lockedAction && plan.toolCalls.length === 0) {
    const rebuilt = toolCallFromRoute(route, query);
    if (rebuilt) plan.toolCalls = [rebuilt];
  }

  planSteps.push(...plan.toolCalls.map((c) => `${c.tool}.${c.action}`));

  if (requestMode === 'dry_run') {
    let previewCalls = plan.toolCalls;
    if (previewCalls.length === 0 && route.lockedTool && route.lockedAction) {
      const rebuilt = toolCallFromRoute({ ...route, mode: 'dry_run' }, query);
      if (rebuilt) previewCalls = [rebuilt];
    }
    const reply = dryRunReplyForPlan(previewCalls);
    return {
      reply,
      plan: { ...plan, toolCalls: [], responseDraft: reply, reasoning: 'Dry-run — execution skipped.' },
      executedCalls: [],
      pendingApprovalIds: [],
      workflow: {
        intent: osIntent,
        reasoning: [...reasoning, 'Dry-run — no execution.'],
        planSteps: previewCalls.map((c) => `${c.tool}.${c.action}`),
        steps: [],
        retries: 0,
        durationMs: Date.now() - started,
        decision: emptyDecision(previewCalls, strippedTools),
      },
    };
  }

  const { executedCalls, pendingApprovalIds, steps, retries } = await executePlanResilient(
    organizationId,
    plan,
    requestedByUserId
  );

  const decision = buildDecisionRecord({
    query,
    intent: osIntent,
    family: intentFamily,
    mode: requestMode,
    selected: plan.toolCalls,
    stripped: strippedTools,
    pendingApprovalIds,
    executedCount: executedCalls.filter((c) => c.ok).length,
    route,
  });
  reasoning.push(
    `Decision: family=${decision.intentFamily} locked=${decision.lockedTool}.${decision.lockedAction} validation=${decision.validation} execution=${decision.execution}`
  );

  const approvalNote =
    pendingApprovalIds.length > 0
      ? `\n\nNote: ${pendingApprovalIds.length} action(s) need your approval before they run — check Approvals.`
      : '';

  let reply: string;
  const q = query.trim().toLowerCase();
  if (/^(slack|notion)\s*\??$/.test(q) && executedCalls.length === 0) {
    reply = q.startsWith('slack')
      ? `Slack is connected (live). Try:\n- create new channel investor-pitch\n- post "kickoff in 10 mins" to #general on slack\n- Create a launch war room for Project Atlas`
      : `Notion is connected (live). Try:\n- create a notion page titled Weekly Update`;
  } else if (executedCalls.length === 0 && pendingApprovalIds.length === 0) {
    reply =
      plan.responseDraft ||
      `I understood this as **${osIntent.kind}** (${route.rationale}). No tool ran.`;
  } else {
    reply = formatReply(executedCalls, plan, approvalNote);
  }

  const memoryKeys = await rememberFromExecution(organizationId, requestedByUserId, query, executedCalls);
  const success = executedCalls.length === 0 || executedCalls.some((c) => c.ok);
  await logWorkflow({
    organizationId,
    userId: requestedByUserId,
    query,
    intent: osIntent,
    reasoning,
    planSteps,
    steps,
    retries,
    durationMs: Date.now() - started,
    success,
    replyPreview: reply,
  });

  return {
    reply,
    plan,
    executedCalls,
    pendingApprovalIds,
    workflow: {
      intent: osIntent,
      reasoning,
      planSteps,
      steps,
      retries,
      durationMs: Date.now() - started,
      memoryKeys,
      decision,
    },
  };
}
