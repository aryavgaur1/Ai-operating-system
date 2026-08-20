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
  stampCapabilityContext,
} from './os';
import { formatGmailSearchReply } from './os/gmailQuery';
import { expandGmailFollowUp, type GmailSearchMemory } from './os/workAssistantIntent';
import { recall } from './os/threadMemory';

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
        const lines = pending.map((c) => {
          const product =
            c.tool === 'slack'
              ? 'Slack'
              : c.tool === 'gmail'
                ? 'Gmail'
                : c.tool === 'jira'
                  ? 'Jira'
                  : c.tool === 'notion'
                    ? 'Notion'
                    : c.tool;
          if (c.tool === 'slack' && (c.action === 'postMessage' || c.action === 'postMessageExternalChannel')) {
            const ch = String(c.input?.channel ?? 'channel').replace(/^#/, '');
            return `• Prepared a Slack message for **#${ch}** — waiting for your approval before send`;
          }
          if (c.tool === 'gmail' && c.action === 'sendEmail') {
            const to = c.input?.to ? ` to ${c.input.to}` : '';
            return `• Prepared a Gmail draft${to} — waiting for your approval before send`;
          }
          if (c.tool === 'jira' && c.action === 'createIssue') {
            const summary = String(c.input?.summary ?? 'new issue');
            return `• Prepared a Jira ticket “${summary.slice(0, 80)}” — waiting for your approval`;
          }
          return `• Prepared a ${product} action — waiting for your approval`;
        });
        return (
          `I've prepared ${pending.length} action${pending.length === 1 ? '' : 's'} and paused for your review:\n\n` +
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
      const product = call.tool === 'gmail' ? 'Gmail' : call.tool === 'slack' ? 'Slack' : call.tool === 'jira' ? 'Jira' : call.tool === 'notion' ? 'Notion' : call.tool;
      return `${product} isn't connected for live actions yet. Connect it under Integrations, then ask again.`;
    }
    if (!call.ok) {
      const err = call.error ?? 'still blocked';
      if (/^Not (connected|implemented)/i.test(err)) {
        return err;
      }
      if (/isn't connected|not connected|Integrations/i.test(err)) {
        return err;
      }
      const product = call.tool === 'gmail' ? 'Gmail' : call.tool === 'slack' ? 'Slack' : call.tool === 'jira' ? 'Jira' : call.tool === 'notion' ? 'Notion' : 'that tool';
      return `I couldn't complete that because ${product} didn't respond. ${err}`;
    }

    const output = call.output as Record<string, unknown> | undefined;
    const planned = plan.toolCalls[idx];

    if (call.tool === 'slack' && call.action === 'createChannel') {
      const name = String(output?.name ?? planned?.input?.name ?? 'channel');
      const id = output?.id ? ` (id: ${output.id})` : '';
      const url = output?.url ? `\nOpen: ${output.url}` : '';
      if (output?.reused) return `Slack channel #${name} already existed — reused it${id}.${url}`;
      return `Created Slack channel #${name}${id}.${url}`;
    }
    if (call.tool === 'slack' && (call.action === 'postMessage' || call.action === 'postMessageExternalChannel')) {
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? output?.channel ?? 'channel');
      const display = channelName.startsWith('@') ? channelName : `#${channelName.replace(/^#/, '')}`;
      return `Done. Posted to ${display}.`;
    }
    if (call.tool === 'slack' && call.action === 'listChannels') {
      const channels = (output?.channels as Array<{ name?: string }>) ?? [];
      const names = channels
        .slice(0, 15)
        .map((c) => `#${c.name ?? '?'}`)
        .join(', ');
      return `I found ${channels.length} Slack channel${channels.length === 1 ? '' : 's'}: ${names}${channels.length > 15 ? '…' : ''}`;
    }
    if (call.tool === 'slack' && call.action === 'listUsers') {
      const users = (output?.users as Array<{ name?: string; real_name?: string; display_name?: string }>) ?? [];
      const names = users
        .slice(0, 15)
        .map((u) => u.real_name || u.display_name || u.name || '?')
        .join(', ');
      return `I found ${users.length} Slack user${users.length === 1 ? '' : 's'}: ${names}${users.length > 15 ? '…' : ''}`;
    }
    if (call.tool === 'slack' && call.action === 'inviteUsers') {
      const invited = (output?.invited as string[]) ?? (output?.users as string[]) ?? [];
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `Invited ${invited.length || 'member(s)'} to #${channelName}.`;
    }
    if (call.tool === 'slack' && call.action === 'getChannelHistory') {
      const messages = (output?.messages as unknown[]) ?? [];
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `I pulled ${messages.length} recent message${messages.length === 1 ? '' : 's'} from #${channelName}.`;
    }
    if (call.tool === 'slack' && call.action === 'searchHistory') {
      const matches = (output?.matches as unknown[]) ?? (output?.messages as unknown[]) ?? [];
      const q = String(planned?.input?.query ?? '');
      return `I found ${matches.length} recent Slack discussion${matches.length === 1 ? '' : 's'}${q ? ` about “${q}”` : ''}.`;
    }
    if (call.tool === 'slack' && call.action === 'setChannelTopic') {
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `Updated the topic on #${channelName}.`;
    }
    if (call.tool === 'slack' && call.action === 'createBookmark') {
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `Bookmarked a link in #${channelName}.`;
    }
    if (call.tool === 'slack' && call.action === 'createCanvas') {
      const title = String(output?.title ?? planned?.input?.title ?? 'Canvas');
      const channelName = String(output?.channelName ?? planned?.input?.channel ?? 'channel').replace(/^#/, '');
      return `Created canvas “${title}” in #${channelName}.`;
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
        'searchMessages',
      ].includes(call.action)
    ) {
      return String(output?.summary ?? `Finished checking Slack.`);
    }
    if (call.tool === 'notion') {
      const url = output?.url ? ` ${output.url}` : '';
      if (call.action === 'searchPages') {
        const results = (output?.results as unknown[]) ?? [];
        return `I found ${results.length} Notion page${results.length === 1 ? '' : 's'}.`;
      }
      if (call.action === 'createPage') {
        const title = String(output?.title ?? planned?.input?.title ?? 'page');
        return `Created Notion page “${title}”.${url}`;
      }
      if (call.action === 'updatePage') {
        return `Updated the Notion page.${url}`;
      }
      return `Finished in Notion.${url}`;
    }
    if (call.tool === 'gmail') {
      if (call.action === 'searchEmails') {
        return formatGmailSearchReply(output as Record<string, unknown> | undefined);
      }
      if (call.action === 'getThread') {
        const count = Number(output?.messageCount ?? 0);
        return `I opened that Gmail thread (${count} message${count === 1 ? '' : 's'}).`;
      }
      if (call.action === 'sendEmail') {
        const to = output?.to ? ` to ${output.to}` : '';
        const subject = output?.subject ? ` — "${output.subject}"` : '';
        const url = output?.url ? ` ${output.url}` : '';
        return `Email sent${to}${subject}.${url}`;
      }
      if (call.action === 'getEmail') {
        const email = output?.email as
          | { metadata?: { subject?: string; from?: string; snippet?: string }; title?: string; text?: string }
          | undefined;
        const subject = email?.metadata?.subject || email?.title || 'email';
        const from = email?.metadata?.from ? ` from ${email.metadata.from}` : '';
        const body = (email?.text || email?.metadata?.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 500);
        return (
          `Here's **${subject}**${from}.` +
          (body ? `\n\n${body}${body.length >= 500 ? '…' : ''}` : '')
        );
      }
      return `Finished with Gmail.`;
    }
    if (call.tool === 'jira') {
      if (call.action === 'searchIssues') {
        const results = (output?.results as Array<{
          key?: string;
          summary?: string;
          status?: string;
          priority?: string;
          dueDate?: string;
          url?: string;
        }>) ?? [];
        const overdue = Number(output?.overdueCount ?? 0);
        if (results.length === 0) {
          return 'I did not find matching Jira tasks.';
        }
        const head =
          overdue > 0
            ? `You have **${results.length}** open Jira task${results.length === 1 ? '' : 's'}. **${overdue}** look overdue.`
            : `You have **${results.length}** open Jira task${results.length === 1 ? '' : 's'}.`;
        const lines = results.slice(0, 10).map((r, i) => {
          const due = r.dueDate ? ` · due ${r.dueDate}` : '';
          const link = r.url ? ` — [Open](${r.url})` : '';
          return `${i + 1}. **${r.key}** [${r.status || '?'}] ${r.summary || ''}${due}${link}`;
        });
        return `${head}\n\n${lines.join('\n')}`;
      }
      if (call.action === 'createIssue') {
        const key = output?.key ? ` **${output.key}**` : '';
        const url = output?.url ? ` ${output.url}` : '';
        return `Jira ticket${key} is ready.${url}`;
      }
      return String(output?.summary ?? 'Finished checking Jira.');
    }
    const url = output?.url ? ` ${output.url}` : '';
    return `Done.${url}`;
  });

  return lines.join('\n') + approvalNote;
}

export async function runAgentTurn(
  query: string,
  organizationId: string,
  vectorStore: VectorStore,
  graphStore: GraphStore,
  requestedByUserId?: string,
  conversationId?: string
): Promise<AgentTurnResult> {
  const started = Date.now();

  // Follow-up refinements (“only this week”, “summarize the second”) reuse last Gmail search memory
  let effectiveQuery = query;
  let followUpEmailId: string | undefined;
  try {
    const gmailMem = (await recall(organizationId, 'gmail:search:latest')) as GmailSearchMemory | null;
    const expanded = expandGmailFollowUp(query, gmailMem);
    if (expanded.getEmailId) {
      followUpEmailId = expanded.getEmailId;
      effectiveQuery = query;
    } else if (expanded.query !== query.trim()) {
      effectiveQuery = expanded.query;
    }
  } catch {
    // memory optional
  }

  // ONE authoritative decision for the entire turn
  let route = resolveAuthoritativeRoute(effectiveQuery);
  if (followUpEmailId) {
    route = {
      ...route,
      mode: 'execute',
      family: 'gmail_read',
      osIntent: {
        ...route.osIntent,
        kind: 'simple_action',
        confidence: 0.98,
        rationale: 'Gmail follow-up — open prior search result',
        legacyIntent: 'action',
      },
      lockedTool: 'gmail',
      lockedAction: 'getEmail',
      routeAction: 'read',
      entities: { ...route.entities, emailId: followUpEmailId },
      confidence: 0.98,
      ambiguous: false,
      allowWorkflow: false,
      clarifyMessage: undefined,
      rationale: 'Follow-up: gmail.getEmail from prior search memory',
    };
  }
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
    const locked = toolCallFromRoute(route, effectiveQuery);
    if (locked && route.lockedAction) {
      plan = {
        intent: { ...legacyIntent, intent: 'action' },
        reasoning: `Locked by authoritative route: ${locked.tool}.${locked.action}`,
        toolCalls: [locked],
        responseDraft: `Prepared ${locked.tool}.${locked.action} for review.`,
      };
    } else {
      plan = await buildPlan(
        effectiveQuery,
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
    const rebuilt = toolCallFromRoute(route, effectiveQuery);
    if (rebuilt) plan.toolCalls = [rebuilt];
  }

  // Stamp capability scope onto every call (survives Approvals → executeApprovedAction)
  plan.toolCalls = plan.toolCalls.map((c) => stampCapabilityContext(c, route));

  planSteps.push(...plan.toolCalls.map((c) => `${c.tool}.${c.action}`));

  // Gmail send without a real recipient — never invent one; ask first.
  const gmailSend = plan.toolCalls.find((c) => c.tool === 'gmail' && c.action === 'sendEmail');
  if (gmailSend && !String(gmailSend.input.to ?? '').trim()) {
    const reply =
      `I can send email via your connected Gmail, but I need a real recipient.\n\n` +
      `Reply like: **Send an email to name@company.com about &lt;subject&gt;**`;
    return {
      reply,
      plan: { ...plan, toolCalls: [], responseDraft: reply, reasoning: 'gmail.sendEmail missing to' },
      executedCalls: [],
      pendingApprovalIds: [],
      workflow: {
        intent: osIntent,
        reasoning: [...reasoning, 'Blocked gmail.sendEmail — missing recipient'],
        planSteps: [],
        steps: [],
        retries: 0,
        durationMs: Date.now() - started,
        decision: emptyDecision([], [
          { tool: 'gmail', action: 'sendEmail', reason: 'missing_field:to' },
        ]),
      },
    };
  }

  if (requestMode === 'dry_run') {
    let previewCalls = plan.toolCalls;
    if (previewCalls.length === 0 && route.lockedTool && route.lockedAction) {
      const rebuilt = toolCallFromRoute({ ...route, mode: 'dry_run' }, effectiveQuery);
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
    requestedByUserId,
    conversationId
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
