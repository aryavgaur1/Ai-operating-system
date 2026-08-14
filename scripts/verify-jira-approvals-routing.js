#!/usr/bin/env node
/**
 * Deep regression: routing safety for Jira / Slack / meta modes / approvals.
 * Run: node scripts/verify-jira-approvals-routing.js
 */
const assert = require('assert');
const path = require('path');

const shared = require(path.join(__dirname, '../packages/shared/dist'));
const {
  detectOsIntent,
  isExplicitJiraCreate,
  isExplicitJiraDelete,
} = require(path.join(__dirname, '../packages/agent-core/dist/os/intentDetector'));
const {
  detectRequestMode,
  resolveIntentFamily,
  filterToolCallsByFamily,
} = require(path.join(__dirname, '../packages/agent-core/dist/os/routingPolicy'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));
const { planWorkflow } = require(path.join(__dirname, '../packages/agent-core/dist/os/workflowPlanner'));

async function planFor(query) {
  const intent = detectOsIntent(query);
  const llm = { async complete() { return 'ok'; } };
  const plan = await buildPlan(
    query,
    { intent: 'action', confidence: 0.9, rationale: intent.rationale },
    { vectorMatches: [], graph: { nodes: [], edges: [] }, keywordMatches: [] },
    llm
  );
  const family = resolveIntentFamily(intent, query);
  const filtered = filterToolCallsByFamily(plan.toolCalls, family);
  return { intent, plan: { ...plan, toolCalls: filtered.kept }, family, mode: detectRequestMode(query) };
}

async function main() {
  // --- High-consequence gating restored ---
  assert.strictEqual(shared.isHighConsequence('slack', 'createWarRoom'), true, 'war room must gate');
  assert.strictEqual(shared.isHighConsequence('slack', 'createIncident'), true, 'incident must gate');
  assert.strictEqual(shared.isHighConsequence('slack', 'followUpPendingReplies'), true, 'follow-up must gate');
  assert.strictEqual(shared.isHighConsequence('jira', 'createIssue'), true, 'jira create must gate');
  console.log('PASS high-consequence gating');

  const cases = [
    {
      q: 'Create a vendor Jira ticket',
      expectMode: 'execute',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
      forbidSlackWarRoom: true,
    },
    {
      q: 'Create a Jira ticket to track the vendor contract follow-up',
      expectMode: 'execute',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
      forbidSlackWarRoom: true,
    },
    {
      q: 'Create a Jira ticket for vendor onboarding.',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
    },
    {
      q: 'Create a vendor ticket in Jira.',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
    },
    {
      q: "Don't create anything yet. Tell me what information you need for the vendor ticket.",
      expectMode: 'clarify',
      expectNoTools: true,
    },
    {
      q: 'Create a vendor Jira ticket with priority high.',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
    },
    {
      q: 'Create a vendor Jira ticket but ask me before actually submitting it.',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
    },
    {
      q: "Show me what you would create, but don't execute it.",
      expectMode: 'dry_run',
      expectNoTools: true,
    },
    {
      q: 'Cancel the previous ticket request.',
      expectMode: 'cancel',
      expectNoTools: true,
    },
    {
      q: 'Delete the Jira ticket PROJ-123',
      expectTool: 'jira',
      expectAction: 'deleteIssue',
      expectApproval: true,
    },
    {
      q: 'Create a launch war room for Project Atlas',
      expectIntent: 'launch_workflow',
      expectTool: 'slack',
      expectAction: 'createWarRoom',
      expectApproval: true,
    },
    {
      q: 'follow up on pending approvals in slack',
      expectIntent: 'reminder_workflow',
    },
    {
      q: 'Post to #ops on Slack: standup summary ready',
      expectTool: 'slack',
      expectAction: 'postMessage',
      expectApproval: true,
    },
    {
      q: 'Create a Notion page called Investor Notes',
      expectTool: 'notion',
      expectAction: 'createPage',
      expectApproval: true,
    },
  ];

  for (const c of cases) {
    const { intent, plan, mode } = await planFor(c.q);

    if (c.expectMode) {
      assert.strictEqual(mode, c.expectMode, `mode for: ${c.q}`);
    }
    if (c.expectIntent) {
      assert.strictEqual(intent.kind, c.expectIntent, `intent for: ${c.q}`);
    }
    if (c.expectNoTools) {
      // Meta modes: proposeToolCalls returns []; dry_run/cancel/clarify must not execute
      if (c.expectMode === 'clarify' || c.expectMode === 'cancel' || c.expectMode === 'dry_run') {
        assert.strictEqual(detectRequestMode(c.q), c.expectMode, `meta mode: ${c.q}`);
        assert.ok(!isExplicitJiraCreate(c.q) || c.expectMode === 'dry_run', `no forced create: ${c.q}`);
      }
      // For dry_run/cancel/clarify, planner should not propose writes when mode != execute
      if (c.expectMode === 'clarify' || c.expectMode === 'cancel') {
        assert.strictEqual(plan.toolCalls.length, 0, `no tools for: ${c.q}`);
      }
      if (c.expectMode === 'dry_run') {
        assert.strictEqual(plan.toolCalls.length, 0, `dry_run plan empty: ${c.q}`);
      }
    }
    if (c.expectTool) {
      // For war room, tool may come from workflow planner not buildPlan
      let call = plan.toolCalls[0];
      if (!call && c.expectAction === 'createWarRoom') {
        const wf = planWorkflow(c.q, intent);
        call = wf.toolCalls.find((t) => t.tool === 'slack' && t.action === 'createWarRoom');
        assert.ok(call, `war room workflow for: ${c.q}`);
        assert.strictEqual(shared.isHighConsequence('slack', 'createWarRoom'), true);
        assert.strictEqual(call.requiresApproval, true, `war room approval for: ${c.q}`);
      } else {
        assert.ok(call, `expected tool call for: ${c.q}`);
        assert.strictEqual(call.tool, c.expectTool, `tool for: ${c.q}`);
        assert.strictEqual(call.action, c.expectAction, `action for: ${c.q}`);
        if (c.expectApproval != null) {
          assert.strictEqual(call.requiresApproval, c.expectApproval, `approval for: ${c.q}`);
          assert.strictEqual(shared.isHighConsequence(call.tool, call.action), true);
        }
      }
      if (c.forbidSlackWarRoom) {
        assert.ok(
          !plan.toolCalls.some((t) => t.tool === 'slack' && t.action === 'createWarRoom'),
          `no war room for: ${c.q}`
        );
      }
    }
    if (c.q.toLowerCase().includes('delete')) {
      assert.ok(isExplicitJiraDelete(c.q), `delete detector: ${c.q}`);
      assert.ok(!isExplicitJiraCreate(c.q), `delete is not create: ${c.q}`);
    }
    console.log('PASS', c.q.slice(0, 72));
  }

  // Family isolation: jira family cannot keep war room
  const stolen = filterToolCallsByFamily(
    [
      { tool: 'slack', action: 'createWarRoom', input: {}, riskLevel: 'high', requiresApproval: true },
      { tool: 'jira', action: 'createIssue', input: { summary: 'x' }, riskLevel: 'high', requiresApproval: true },
    ],
    'jira'
  );
  assert.strictEqual(stolen.kept.length, 1);
  assert.strictEqual(stolen.kept[0].tool, 'jira');
  assert.strictEqual(stolen.stripped[0].action, 'createWarRoom');
  console.log('PASS jira family strips war room');

  console.log('\nAll routing regressions passed.');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
