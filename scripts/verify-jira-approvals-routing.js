#!/usr/bin/env node
/**
 * Phase 1 regression: authoritative routing — no wrong-tool execution.
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
  resolveAuthoritativeRoute,
  filterToolCallsByFamily,
  toolCallFromRoute,
} = require(path.join(__dirname, '../packages/agent-core/dist/os/routingPolicy'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));
const { planWorkflow } = require(path.join(__dirname, '../packages/agent-core/dist/os/workflowPlanner'));

async function planFor(query) {
  const route = resolveAuthoritativeRoute(query);
  const llm = { async complete() { return 'ok'; } };
  const plan = await buildPlan(
    query,
    { intent: 'action', confidence: 0.9, rationale: route.rationale },
    { vectorMatches: [], graph: { nodes: [], edges: [] }, keywordMatches: [] },
    llm,
    route
  );
  const filtered = filterToolCallsByFamily(plan.toolCalls, route.family, route);
  let calls = filtered.kept;
  if (route.lockedTool && route.lockedAction && calls.length === 0 && route.mode === 'execute') {
    const locked = toolCallFromRoute(route, query);
    if (locked) calls = [locked];
  }
  return { route, plan: { ...plan, toolCalls: calls } };
}

async function main() {
  assert.strictEqual(shared.isHighConsequence('slack', 'createWarRoom'), true);
  assert.strictEqual(shared.isHighConsequence('jira', 'createIssue'), true);
  console.log('PASS high-consequence gating');

  const cases = [
    {
      q: 'Create a vendor Jira ticket',
      expectMode: 'execute',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
      forbidSlack: true,
      expectLocked: true,
    },
    {
      q: 'Create a Jira ticket to track the vendor contract follow-up',
      expectTool: 'jira',
      expectAction: 'createIssue',
      forbidSlack: true,
    },
    {
      q: 'Create a Jira ticket for vendor onboarding.',
      expectTool: 'jira',
      expectAction: 'createIssue',
    },
    {
      q: 'Create a vendor ticket in Jira.',
      expectTool: 'jira',
      expectAction: 'createIssue',
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
    },
    {
      q: "Show me what you would create, but don't execute it.",
      expectMode: 'dry_run',
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
      expectFamily: 'launch',
      expectTool: 'slack',
      expectAction: 'createWarRoom',
      expectApproval: true,
    },
    {
      q: 'follow up on pending approvals in slack',
      expectFamily: 'reminder',
    },
    {
      q: 'Post to #ops on Slack: standup summary ready',
      expectTool: 'slack',
      expectAction: 'postMessage',
    },
    {
      q: 'Create a Notion page called Investor Notes',
      expectTool: 'notion',
      expectAction: 'createPage',
    },
    {
      q: 'handle the vendor thing',
      expectMode: 'clarify',
      expectNoTools: true,
      expectAmbiguous: true,
    },
    {
      q: 'do something with the ticket and also slack',
      expectMode: 'clarify',
      expectNoTools: true,
    },
  ];

  for (const c of cases) {
    const { route, plan } = await planFor(c.q);

    if (c.expectMode) assert.strictEqual(route.mode, c.expectMode, `mode: ${c.q}`);
    if (c.expectFamily) assert.strictEqual(route.family, c.expectFamily, `family: ${c.q}`);
    if (c.expectAmbiguous) assert.strictEqual(route.ambiguous, true, `ambiguous: ${c.q}`);
    if (c.expectLocked) {
      assert.strictEqual(route.lockedTool, 'jira');
      assert.strictEqual(route.lockedAction, 'createIssue');
      assert.strictEqual(route.allowWorkflow, false);
    }
    if (c.expectNoTools) {
      assert.strictEqual(plan.toolCalls.length, 0, `no tools: ${c.q}`);
    }
    if (c.expectTool) {
      let call = plan.toolCalls[0];
      if (!call && c.expectAction === 'createWarRoom') {
        const wf = planWorkflow(c.q, route.osIntent);
        call = wf.toolCalls.find((t) => t.action === 'createWarRoom');
        assert.ok(call, `war room: ${c.q}`);
        assert.strictEqual(call.requiresApproval, true);
      } else {
        assert.ok(call, `tool for: ${c.q} (got ${JSON.stringify(route)})`);
        assert.strictEqual(call.tool, c.expectTool, `tool: ${c.q}`);
        assert.strictEqual(call.action, c.expectAction, `action: ${c.q}`);
        if (c.expectApproval != null) {
          assert.strictEqual(call.requiresApproval, c.expectApproval, `approval: ${c.q}`);
        }
      }
      if (c.forbidSlack) {
        assert.ok(!plan.toolCalls.some((t) => t.tool === 'slack'), `no slack: ${c.q}`);
        const wf = planWorkflow(c.q, route.osIntent);
        // Even if workflow planner would fire, route forbids it
        assert.strictEqual(route.allowWorkflow, false, `no workflow: ${c.q}`);
        assert.ok(
          !wf.toolCalls.length || route.family === 'jira',
          `workflow empty or ignored for jira: ${c.q}`
        );
      }
    }
    if (/delete/i.test(c.q) && /jira|ticket|issue/i.test(c.q)) {
      assert.ok(isExplicitJiraDelete(c.q));
      assert.ok(!isExplicitJiraCreate(c.q));
    }
    console.log('PASS', c.q.slice(0, 72));
  }

  // Cross-contamination: inject war room into jira family → stripped
  const stolen = filterToolCallsByFamily(
    [
      { tool: 'slack', action: 'createWarRoom', input: {}, riskLevel: 'high', requiresApproval: true },
      { tool: 'jira', action: 'createIssue', input: { summary: 'x' }, riskLevel: 'high', requiresApproval: true },
    ],
    'jira',
    resolveAuthoritativeRoute('Create a vendor Jira ticket')
  );
  assert.strictEqual(stolen.kept.length, 1);
  assert.strictEqual(stolen.kept[0].tool, 'jira');
  assert.ok(stolen.stripped.some((s) => s.action === 'createWarRoom'));
  console.log('PASS jira family strips war room');

  // Follow-up in jira create phrase must still lock jira
  const follow = resolveAuthoritativeRoute('create a jira ticket to track the vendor Contract follow up');
  assert.strictEqual(follow.lockedTool, 'jira');
  assert.strictEqual(follow.lockedAction, 'createIssue');
  assert.strictEqual(follow.allowWorkflow, false);
  console.log('PASS follow-up phrase cannot steal to Slack');

  // History/memory context must not steal Slack/Notion into Jira
  const poisonedSlack = resolveAuthoritativeRoute(
    'Post to #general on Slack: "Nexora verify"\n\n[Context for planner — do not invent results]\nConversation history:\nUSER: Create a Jira ticket to track the vendor Contract follow up'
  );
  assert.ok(poisonedSlack.family === 'slack_write' || poisonedSlack.lockedTool === 'slack');
  assert.notStrictEqual(poisonedSlack.lockedAction, 'createIssue');
  console.log('PASS planner context cannot steal Slack → Jira');

  const poisonedNotion = resolveAuthoritativeRoute(
    'Create a Notion page called "Investor Notes"\n\n[Context for planner — do not invent results]\nConversation history:\nUSER: Create a Jira ticket'
  );
  assert.ok(poisonedNotion.family === 'notion' || poisonedNotion.lockedTool === 'notion');
  assert.notStrictEqual(poisonedNotion.lockedAction, 'createIssue');
  console.log('PASS planner context cannot steal Notion → Jira');

  console.log('\nAll Phase 1 authoritative routing regressions passed.');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
