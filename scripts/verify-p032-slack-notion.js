#!/usr/bin/env node
/**
 * P0.3.2 — Slack + Notion real execution standard (application behavior, no live spam).
 *
 * Covers:
 * 1–4 capability isolation for Slack/Notion
 * 5 approval required
 * 6 payload cannot change after approval
 * 7 expired approval cannot execute
 * 8 replay cannot execute twice
 * 9 failed Slack reported FAILED
 * 10 failed Notion reported FAILED
 * 11 Jira regression
 *
 * Run: node scripts/verify-p032-slack-notion.js
 */
const assert = require('assert');
const path = require('path');

process.env.SAAS_MODE = 'false';
delete process.env.DATABASE_URL;

const {
  resolveAuthoritativeRoute,
  filterToolCallsByFamily,
  toolCallFromRoute,
  buildCapabilityScope,
  stampCapabilityContext,
  filterCallsByCapabilityScope,
  getCapability,
  useInMemoryApprovalStoreForTests,
  resetApprovalStoreForTests,
  executeApprovedAction,
  computeApprovalFingerprint,
  rejectMockOrUnverified,
} = require(path.join(__dirname, '../packages/agent-core/dist'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));
const { isHighConsequence } = require(path.join(__dirname, '../packages/shared/dist'));

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
  calls = calls.map((c) => stampCapabilityContext(c, route));
  return { route, calls };
}

function stamp(tool, action, input, query) {
  const route = resolveAuthoritativeRoute(query);
  return stampCapabilityContext(
    {
      tool,
      action,
      input,
      riskLevel: 'high',
      requiresApproval: true,
    },
    route
  );
}

async function main() {
  // —— 1 Slack intent → Slack capability ——
  {
    const { route, calls } = await planFor('Post "Nexora execution test" in #test on Slack');
    assert.ok(route.family === 'slack_write' || route.lockedTool === 'slack');
    assert.ok(calls.some((c) => c.tool === 'slack' && c.action === 'postMessage'));
    assert.ok(!calls.some((c) => c.tool === 'notion' || c.tool === 'jira'));
    console.log('PASS 1 Slack intent → slack.postMessage');
  }

  // —— 2 Slack cannot execute Notion/Jira ——
  {
    const route = resolveAuthoritativeRoute('Post to #ops on Slack: hello');
    const scope = buildCapabilityScope(route);
    assert.ok(scope.allowed.has('slack.postMessage'));
    assert.ok(!scope.allowed.has('notion.createPage'));
    assert.ok(!scope.allowed.has('jira.createIssue'));
    const inj = filterCallsByCapabilityScope(
      [
        {
          tool: 'notion',
          action: 'createPage',
          input: { title: 'x', _capabilityScope: ['notion.createPage'], _intentFamily: 'notion' },
          riskLevel: 'high',
          requiresApproval: true,
        },
        {
          tool: 'jira',
          action: 'createIssue',
          input: { summary: 'x', _capabilityScope: ['jira.createIssue'], _intentFamily: 'jira' },
          riskLevel: 'high',
          requiresApproval: true,
        },
      ],
      scope
    );
    assert.strictEqual(inj.kept.length, 0);
    assert.ok(inj.stripped.every((s) => s.reason === 'CAPABILITY_NOT_ALLOWED'));
    console.log('PASS 2 Slack scope rejects Notion/Jira');
  }

  // —— 3 Notion intent → Notion capability ——
  {
    const { route, calls } = await planFor('Create a Notion page called Nexora Execution Test');
    assert.ok(route.family === 'notion' || route.lockedTool === 'notion');
    assert.ok(calls.some((c) => c.tool === 'notion' && c.action === 'createPage'));
    assert.ok(!calls.some((c) => c.tool === 'slack' || c.tool === 'jira'));
    console.log('PASS 3 Notion intent → notion.createPage');
  }

  // —— 4 Notion cannot execute Slack/Jira ——
  {
    const route = resolveAuthoritativeRoute('Create a Notion page called Test');
    const scope = buildCapabilityScope(route);
    assert.ok(scope.allowed.has('notion.createPage'));
    assert.ok(!scope.allowed.has('slack.postMessage'));
    assert.ok(!scope.allowed.has('jira.createIssue'));
    const inj = filterCallsByCapabilityScope(
      [
        {
          tool: 'slack',
          action: 'postMessage',
          input: { channel: 'x', text: 'y', _capabilityScope: ['slack.postMessage'], _intentFamily: 'slack_write' },
          riskLevel: 'high',
          requiresApproval: true,
        },
      ],
      scope
    );
    assert.strictEqual(inj.kept.length, 0);
    console.log('PASS 4 Notion scope rejects Slack/Jira');
  }

  // —— 5 Approval required ——
  {
    assert.ok(getCapability('slack', 'postMessage').approvalRequired);
    assert.ok(getCapability('notion', 'createPage').approvalRequired);
    assert.ok(isHighConsequence('slack', 'postMessage'));
    assert.ok(isHighConsequence('notion', 'createPage'));
    const { calls: s } = await planFor('Post to #ops on Slack: "hi"');
    const { calls: n } = await planFor('Create a Notion page called Hi');
    assert.ok(s.find((c) => c.action === 'postMessage').requiresApproval);
    assert.ok(n.find((c) => c.action === 'createPage').requiresApproval);
    console.log('PASS 5 approval required for Slack/Notion writes');
  }

  // —— 6 Payload cannot change after approval ——
  {
    resetApprovalStoreForTests();
    const store = useInMemoryApprovalStoreForTests();
    const call = stamp(
      'slack',
      'postMessage',
      { channel: 'test', text: 'Nexora integrity' },
      'Post to #test on Slack: "Nexora integrity"'
    );
    const a = await store.create('org-1', call, 'user-1');
    assert.ok(a.payloadFingerprint);
    await store.claimForExecution(a.id, 'user-1');
    const row = await store.get(a.id);
    row.input = { ...row.input, text: 'TAMPERED' };
    const result = await executeApprovedAction(a.id);
    assert.ok(result);
    assert.strictEqual(result.ok, false);
    assert.ok(/APPROVAL_PAYLOAD_CHANGED/.test(String(result.error)));
    console.log('PASS 6 Slack payload tamper rejected');
  }
  {
    resetApprovalStoreForTests();
    const store = useInMemoryApprovalStoreForTests();
    const call = stamp(
      'notion',
      'createPage',
      { title: 'Nexora integrity', body: 'x' },
      'Create a Notion page called Nexora integrity'
    );
    const a = await store.create('org-1', call, 'user-1');
    await store.claimForExecution(a.id, 'user-1');
    const row = await store.get(a.id);
    row.input = { ...row.input, title: 'TAMPERED TITLE' };
    const result = await executeApprovedAction(a.id);
    assert.ok(result);
    assert.strictEqual(result.ok, false);
    assert.ok(/APPROVAL_PAYLOAD_CHANGED/.test(String(result.error)));
    console.log('PASS 6b Notion payload tamper rejected');
  }

  // —— 7 Expired approval cannot execute ——
  {
    resetApprovalStoreForTests();
    const store = useInMemoryApprovalStoreForTests();
    const call = stamp(
      'slack',
      'postMessage',
      { channel: 'test', text: 'expired' },
      'Post to #test on Slack: "expired"'
    );
    const a = await store.create('org-1', call, 'user-1');
    const row = await store.get(a.id);
    row.expiresAt = new Date(Date.now() - 60_000).toISOString();
    const claimed = await store.claimForExecution(a.id, 'user-1');
    assert.strictEqual(claimed, undefined);
    const after = await store.get(a.id);
    assert.strictEqual(after.status, 'expired');
    const result = await executeApprovedAction(a.id);
    assert.strictEqual(result, undefined);
    console.log('PASS 7 expired Slack approval rejected');
  }

  // —— 8 Replay cannot execute twice ——
  {
    resetApprovalStoreForTests();
    const store = useInMemoryApprovalStoreForTests();
    const call = stamp(
      'notion',
      'createPage',
      { title: 'Replay guard', body: 'x' },
      'Create a Notion page called Replay guard'
    );
    const a = await store.create('org-1', call, 'user-1');
    const claimed = await store.claimForExecution(a.id, 'user-1');
    assert.ok(claimed);
    // Simulate completed execution without live connector
    const done = {
      tool: 'notion',
      action: 'createPage',
      ok: true,
      mocked: false,
      output: { id: 'fake-for-idempotency-only', verified: true },
    };
    await store.completeExecution(a.id, done, true);
    const again = await executeApprovedAction(a.id);
    assert.ok(again);
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.output?.id, 'fake-for-idempotency-only');
    // Second claim must fail
    const reclaim = await store.claimForExecution(a.id, 'user-1');
    assert.ok(!reclaim);
    console.log('PASS 8 replay returns stored result; cannot re-claim');
  }

  // —— 9 Failed Slack execution reported FAILED ——
  {
    const mockOk = rejectMockOrUnverified(
      { tool: 'slack', action: 'postMessage', ok: true, mocked: true, output: { ts: '1' } },
      false
    );
    assert.strictEqual(mockOk.ok, false);
    assert.ok(/mock|Refusing/i.test(String(mockOk.error)));

    const unverified = rejectMockOrUnverified(
      {
        tool: 'slack',
        action: 'postMessage',
        ok: true,
        mocked: false,
        output: { channel: 'C1', ts: '1.2' },
      },
      false
    );
    assert.strictEqual(unverified.ok, false);
    assert.ok(/verification failed/i.test(String(unverified.error)));
    console.log('PASS 9 Slack mock/unverified → FAILED');
  }

  // —— 10 Failed Notion execution reported FAILED ——
  {
    const mockOk = rejectMockOrUnverified(
      { tool: 'notion', action: 'createPage', ok: true, mocked: true, output: { id: 'x' } },
      false
    );
    assert.strictEqual(mockOk.ok, false);

    const unverified = rejectMockOrUnverified(
      { tool: 'notion', action: 'createPage', ok: true, mocked: false, output: { id: 'x', url: 'https://notion.so/x' } },
      false
    );
    assert.strictEqual(unverified.ok, false);
    assert.ok(/verification failed/i.test(String(unverified.error)));
    console.log('PASS 10 Notion mock/unverified → FAILED');
  }

  // —— 11 Jira regression ——
  {
    const { route, calls } = await planFor('Create a Jira ticket titled vendor follow-up');
    assert.strictEqual(route.lockedTool, 'jira');
    assert.strictEqual(route.lockedAction, 'createIssue');
    assert.ok(calls.some((c) => c.tool === 'jira' && c.action === 'createIssue'));
    assert.ok(!calls.some((c) => c.tool === 'slack' || c.tool === 'notion'));
    assert.ok(getCapability('jira', 'createIssue').approvalRequired);
    assert.ok(isHighConsequence('jira', 'createIssue'));
    const fp = computeApprovalFingerprint('jira', 'createIssue', { summary: 'x', project: 'KAN' });
    assert.ok(fp && fp.length > 8);
    console.log('PASS 11 Jira regression');
  }

  console.log('\nAll P0.3.2 Slack/Notion behavior checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
