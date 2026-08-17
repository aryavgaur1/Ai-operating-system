import type { OsIntent, ToolCall } from '@enterprise-ai-os/shared';
import {
  isHighConsequence,
  policyAllowsAutoRun,
  DEFAULT_APPROVAL_POLICY,
} from '@enterprise-ai-os/shared';
import { resolveNotionCreateBody } from '../notionContent';

// ============================================================
// STEP 2 — Workflow Planner
// Decompose goals into ordered tool calls BEFORE execution.
// Uses existing connector actions (createWarRoom, etc.) so we
// extend architecture without rewriting integrations.
// ============================================================

export interface WorkflowPlan {
  reasoning: string[];
  planSteps: string[];
  toolCalls: ToolCall[];
}

function call(tool: ToolCall['tool'], action: string, input: Record<string, unknown>): ToolCall {
  const requiresApproval =
    isHighConsequence(tool, action) && !policyAllowsAutoRun(DEFAULT_APPROVAL_POLICY, tool, action);
  return {
    tool,
    action,
    input,
    riskLevel: requiresApproval ? 'high' : 'low',
    requiresApproval,
  };
}

function slug(s: string): string {
  return String(s || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

/** Build a multi-step execution plan from OS intent + raw query. */
export function planWorkflow(query: string, intent: OsIntent): WorkflowPlan {
  const reasoning: string[] = [
    `Intent: ${intent.kind} (${Math.round(intent.confidence * 100)}%) — ${intent.rationale}`,
    'Decomposing into executable steps before any tool call.',
  ];
  const planSteps: string[] = [];
  const toolCalls: ToolCall[] = [];
  const project = intent.entities.project || 'project';

  switch (intent.kind) {
    case 'launch_workflow': {
      planSteps.push(
        'Create Slack war room (channel, topic, invites, canvas, bookmarks, welcome, reminder)',
        'Create Notion project hub page with roadmap checklist',
        'Post kickoff confirmation linking Slack + Notion'
      );
      reasoning.push(
        `Launch “${project}”: need channel, members, canvas, bookmarks, roadmap, Notion hub, kickoff message.`
      );
      toolCalls.push(
        call('slack', 'createWarRoom', {
          project,
          name: `war-room-${slug(project)}`,
          roadmap: `# Roadmap — ${project}\n\n- Kickoff\n- Build\n- QA\n- Launch\n`,
        }),
        call('notion', 'createProject', {
          title: `${project} — Project Hub`,
          body: `Autonomous project hub for **${project}**.\n\n## Mission\nLaunch ${project}.\n\n## Checklist\n- [ ] Kickoff\n- [ ] Roadmap shared\n- [ ] Owners assigned\n- [ ] Weekly sync\n`,
        })
      );
      break;
    }

    case 'incident_workflow': {
      planSteps.push('Open incident channel + runbook + pulse reminder', 'Log incident brief in Notion');
      reasoning.push('Incident requires responders, runbook canvas, action list, stakeholder notify, Notion record.');
      toolCalls.push(
        call('slack', 'createIncident', {
          severity: intent.entities.severity || 'sev-2',
          summary: intent.entities.summary || query,
        }),
        call('notion', 'createPage', {
          title: `Incident — ${intent.entities.severity || 'sev-2'} — ${new Date().toISOString().slice(0, 16)}`,
          body: `## Incident\n${query}\n\n## Timeline\n- Opened by Nexora\n\n## Actions\n- [ ] Mitigate\n- [ ] Comms\n- [ ] Postmortem\n`,
          template: 'doc',
        })
      );
      break;
    }

    case 'standup_workflow': {
      planSteps.push(
        'Collect Slack daily digest / channel intelligence',
        'Create Notion standup notes page',
        'Post standup summary to #general'
      );
      reasoning.push('Standup is multi-tool: Slack context → Notion notes → Slack broadcast.');
      toolCalls.push(
        call('slack', 'dailyDigest', {}),
        call('notion', 'createMeetingNotes', {
          title: `Standup — ${new Date().toISOString().slice(0, 10)}`,
          body: 'Standup prepared by Nexora. Fill blockers and wins after digest lands.',
        })
      );
      break;
    }

    case 'reminder_workflow': {
      planSteps.push('Detect unanswered / pending approval threads', 'Send follow-up nudges');
      reasoning.push('Reminder workflow: find pending replies, then follow up owners.');
      toolCalls.push(call('slack', 'followUpPendingReplies', { dryRun: false }));
      break;
    }

    case 'workspace_intelligence': {
      planSteps.push('Run workspace intelligence tool matched to the question');
      reasoning.push('Intelligence query — select specialized Slack analysis tool.');
      const lower = query.toLowerCase();
      if (/\bcomplaint/.test(lower)) {
        toolCalls.push(call('slack', 'findCustomerComplaints', { query }));
      } else if (/\bunanswered|no reply/.test(lower)) {
        const channel = query.match(/#([a-z0-9_-]+)/i)?.[1];
        toolCalls.push(call('slack', 'findUnansweredMessages', channel ? { channel } : {}));
      } else if (/\bblocker|blocked|delay|delayed|slip|slipped|why\b/.test(lower)) {
        // Prefer semantic search for "why delayed" so we surface the stated reason from Slack
        if (/\b(why|reason|delay|delayed|slip|happened|happening)\b/.test(lower)) {
          toolCalls.push(call('slack', 'semanticSearch', { query }));
        } else {
          const channel = query.match(/#([a-z0-9_-]+)/i)?.[1];
          toolCalls.push(call('slack', 'findBlockers', { query, ...(channel ? { channel } : {}) }));
        }
      } else if (/\bwho owns|owner/.test(lower)) {
        toolCalls.push(call('slack', 'findOwner', { topic: query }));
      } else if (/\bdecid/.test(lower)) {
        toolCalls.push(call('slack', 'findDecision', { query }));
      } else if (/\bdead channel/.test(lower)) {
        toolCalls.push(call('slack', 'detectDeadChannels', {}));
      } else if (/\baction item|todo/.test(lower)) {
        const channel = query.match(/#([a-z0-9_-]+)/i)?.[1];
        toolCalls.push(call('slack', 'detectActionItems', { query, ...(channel ? { channel } : {}) }));
      } else if (/\bdiscussed|semantic|find where|pricing|roadmap|project\b/.test(lower)) {
        toolCalls.push(call('slack', 'semanticSearch', { query }));
      } else if (/\bsummarize|summarise|recap|engineering|product/.test(lower)) {
        const channel = query.match(/#([a-z0-9_-]+)/i)?.[1] ?? 'general';
        toolCalls.push(call('slack', 'summarizeChannel', { channel, limit: 50 }));
      } else {
        toolCalls.push(call('slack', 'semanticSearch', { query }));
      }
      break;
    }

    case 'notion_project': {
      planSteps.push('Create / update Notion artifact from intent');
      reasoning.push('Notion-first workflow.');
      const title = intent.entities.title || query.slice(0, 60);
      const draftBody = resolveNotionCreateBody(query, title);
      const lower = query.toLowerCase();
      if (/\bprd\b/.test(lower)) {
        toolCalls.push(call('notion', 'createPRD', { title, body: draftBody }));
      } else if (/\bwiki\b/.test(lower)) {
        toolCalls.push(call('notion', 'createWiki', { title, body: draftBody }));
      } else if (/\bmeeting/.test(lower)) {
        toolCalls.push(call('notion', 'createMeetingNotes', { title, body: draftBody }));
      } else if (/\b(database|db|table|board|kanban)\b/.test(lower)) {
        toolCalls.push(call('notion', 'createDatabase', { title }));
      } else if (/\broadmap\b/.test(lower)) {
        toolCalls.push(call('notion', 'createRoadmap', { title, body: draftBody }));
      } else if (/\b(project|hub|sprint)\b/.test(lower)) {
        toolCalls.push(call('notion', 'createProject', { title, body: draftBody }));
      } else if (/\b(search|find)\b/.test(lower)) {
        toolCalls.push(call('notion', 'searchPages', { query: title }));
      } else if (/\b(delete|archive|remove)\b/.test(lower)) {
        toolCalls.push(call('notion', 'deletePage', { title }));
      } else if (/\b(publish)\b/.test(lower)) {
        toolCalls.push(call('notion', 'publishPage', { title }));
      } else {
        toolCalls.push(call('notion', 'createPage', { title, body: draftBody, template: 'doc' }));
      }
      break;
    }

    case 'simple_action':
    case 'read_only':
    default:
      // Defer to legacy keyword planner (filled by orchestrator)
      reasoning.push('Simple/legacy path — defer tool selection to existing keyword planner.');
      planSteps.push('Use legacy single/multi action planner');
      break;
  }

  return { reasoning, planSteps, toolCalls };
}
