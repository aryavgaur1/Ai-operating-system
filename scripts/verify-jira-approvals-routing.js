#!/usr/bin/env node
/**
 * Deep regression: Jira create must queue Approvals, never Slack follow-ups.
 * Run: node scripts/verify-jira-approvals-routing.js
 */
const assert = require('assert');
const path = require('path');

// Prefer built packages (what Railway runs)
const shared = require(path.join(__dirname, '../packages/shared/dist'));
const { detectOsIntent } = require(path.join(__dirname, '../packages/agent-core/dist/os/intentDetector'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));

async function planFor(query) {
  const intent = detectOsIntent(query);
  const llm = { async complete() { return 'ok'; } };
  const plan = await buildPlan(
    query,
    { intent: 'action', confidence: 0.9, rationale: intent.rationale },
    { vectorMatches: [], graph: { nodes: [], edges: [] }, keywordMatches: [] },
    llm
  );
  return { intent, plan };
}

async function main() {
  const cases = [
    {
      q: 'Create a Jira ticket to track the vendor contract follow-up',
      expectIntent: 'simple_action',
      expectTool: 'jira',
      expectAction: 'createIssue',
      expectApproval: true,
    },
    {
      q: 'Create a Jira ticket about onboarding docs',
      expectIntent: 'simple_action',
      expectTool: 'jira',
      expectAction: 'createIssue',
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
    const { intent, plan } = await planFor(c.q);
    if (c.expectIntent) {
      assert.strictEqual(intent.kind, c.expectIntent, `intent for: ${c.q}`);
    }
    if (c.expectTool) {
      const call = plan.toolCalls[0];
      assert.ok(call, `expected tool call for: ${c.q}`);
      assert.strictEqual(call.tool, c.expectTool, `tool for: ${c.q}`);
      assert.strictEqual(call.action, c.expectAction, `action for: ${c.q}`);
      if (c.expectApproval != null) {
        assert.strictEqual(call.requiresApproval, c.expectApproval, `approval for: ${c.q}`);
        assert.strictEqual(shared.isHighConsequence(call.tool, call.action), c.expectApproval);
      }
      // Never allow Slack follow-up to steal Jira create
      if (/jira/i.test(c.q) && /ticket|issue/i.test(c.q)) {
        assert.notStrictEqual(call.action, 'followUpPendingReplies');
      }
    }
    console.log('PASS', c.q.slice(0, 72));
  }

  console.log('\nAll routing regressions passed.');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
