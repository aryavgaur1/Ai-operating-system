import type { AgentPlan, AgentTurnResult, ClassifiedIntent } from '@enterprise-ai-os/shared';
import type { VectorStore, GraphStore } from '@enterprise-ai-os/stores';
import { classifyIntent } from './intentClassifier';
import { hybridRetrieve } from './retriever';
import { buildPlan } from './planner';
import { createLLMClient } from './llmClient';
import {
  detectOsIntent,
  planWorkflow,
  executePlanResilient,
  rememberFromExecution,
  logWorkflow,
} from './os';

// ============================================================
// Agent Orchestrator — Enterprise AI OS execution loop
//
//   Prompt → Intent → Planner → Reasoning → Execution Plan
//        → Preflight → Execute → Verify → Heal/Retry → Reply
//
// Preserves legacy keyword planner for simple_action / read_only
// while multi-step workflows use the OS planner.
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
      return `I diagnosed that ${call.tool} is not live yet. ${call.error ?? 'Connect it in Integrations, then ask again.'}`;
    }
    if (!call.ok) {
      return `I tried ${call.tool}.${call.action} and self-healed where possible — ${call.error ?? 'still blocked'}.`;
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

  // STEP 1 — Intent detection (OS) + legacy classifier for compatibility
  const osIntent = detectOsIntent(query);
  const legacyIntent: ClassifiedIntent =
    osIntent.kind === 'read_only'
      ? classifyIntent(query)
      : {
          intent: osIntent.legacyIntent,
          confidence: osIntent.confidence,
          rationale: osIntent.rationale,
        };

  // Retrieval / reasoning context
  const context = await hybridRetrieve(query, organizationId, vectorStore, graphStore);
  const llm = createLLMClient();

  // STEP 2 — Planner: workflow decomposition OR legacy keyword plan
  const workflow = planWorkflow(query, osIntent);
  let plan: AgentPlan;

  if (workflow.toolCalls.length > 0) {
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
  } else {
    // Legacy single-action path (still goes through resilient executor)
    plan = await buildPlan(query, legacyIntent.intent === 'action' ? legacyIntent : { ...legacyIntent, intent: osIntent.legacyIntent }, context, llm);
    workflow.reasoning.push('Legacy planner selected tool calls.');
    workflow.planSteps.push(...plan.toolCalls.map((c) => `${c.tool}.${c.action}`));
  }

  // STEPS 4–7 — Preflight + execute + verify + heal
  const { executedCalls, pendingApprovalIds, steps, retries } = await executePlanResilient(
    organizationId,
    plan,
    requestedByUserId
  );

  const approvalNote =
    pendingApprovalIds.length > 0
      ? `\n\nNote: ${pendingApprovalIds.length} action(s) need your approval before they run — check Approvals.`
      : '';

  let reply: string;
  const q = query.trim().toLowerCase();
  if (/^(slack|notion)\s*\??$/.test(q) && executedCalls.length === 0) {
    reply =
      q.startsWith('slack')
        ? `Slack is connected (live). Try:\n- create new channel investor-pitch\n- post "kickoff in 10 mins" to #general on slack\n- invite Aryav Gaur to #all-nexora on slack\n- Create a launch war room for Project Atlas\n- What blocked Engineering this week?\n- Find unanswered messages`
        : `Notion is connected (live). Try:\n- create a notion page titled Weekly Update\n- Create a Notion PRD for Atlas\n- Create meeting notes in Notion`;
  } else if (executedCalls.length === 0 && pendingApprovalIds.length === 0) {
    // No-fallback policy: diagnose instead of "I couldn't"
    reply =
      plan.responseDraft ||
      `I understood this as **${osIntent.kind}** (${osIntent.rationale}). I did not need a tool yet — ask me to launch a project, open an incident, prepare standup, or create a Notion page.`;
  } else {
    reply = formatReply(executedCalls, plan, approvalNote);
  }

  // STEP 8 — Thread memory
  const memoryKeys = await rememberFromExecution(organizationId, requestedByUserId, query, executedCalls);

  // STEP 10 — Workflow log
  const success = executedCalls.length === 0 || executedCalls.some((c) => c.ok);
  await logWorkflow({
    organizationId,
    userId: requestedByUserId,
    query,
    intent: osIntent,
    reasoning: workflow.reasoning,
    planSteps: workflow.planSteps,
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
      reasoning: workflow.reasoning,
      planSteps: workflow.planSteps,
      steps,
      retries,
      durationMs: Date.now() - started,
      memoryKeys,
    },
  };
}
