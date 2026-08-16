#!/usr/bin/env node
/**
 * P0.1 expansion — Slack + Notion real-execution standard (no live API).
 * Asserts registry, approval gates, planner routing, and verify-method parity with Jira.
 *
 * Run: node scripts/verify-slack-notion-execution.js
 */
const assert = require('assert');
const path = require('path');

const {
  resolveAuthoritativeRoute,
  filterToolCallsByFamily,
  toolCallFromRoute,
  buildCapabilityScope,
  stampCapabilityContext,
  getCapability,
} = require(path.join(__dirname, '../packages/agent-core/dist/os'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));
const { HIGH_CONSEQUENCE_ACTIONS, isHighConsequence } = require(path.join(__dirname, '../packages/shared/dist'));

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

async function main() {
  // Registry: Slack writes require external confirm; Notion update/entry registered
  const post = getCapability('slack', 'postMessage');
  const createCh = getCapability('slack', 'createChannel');
  const invite = getCapability('slack', 'inviteUsers');
  const searchMsg = getCapability('slack', 'searchMessages');
  const createPage = getCapability('notion', 'createPage');
  const updatePage = getCapability('notion', 'updatePage');
  const dbEntry = getCapability('notion', 'createDatabaseEntry');
  const searchPages = getCapability('notion', 'searchPages');

  assert.ok(post && createCh && invite && searchMsg);
  assert.ok(createPage && updatePage && dbEntry && searchPages);
  assert.strictEqual(post.verificationMethod, 'external_confirm');
  assert.strictEqual(createCh.verificationMethod, 'external_confirm');
  assert.strictEqual(invite.verificationMethod, 'external_confirm');
  assert.strictEqual(createPage.verificationMethod, 'get_created');
  assert.strictEqual(updatePage.verificationMethod, 'external_confirm');
  assert.strictEqual(dbEntry.verificationMethod, 'get_created');
  assert.ok(post.approvalRequired);
  assert.ok(createCh.approvalRequired);
  assert.ok(invite.approvalRequired);
  assert.ok(createPage.approvalRequired);
  assert.ok(updatePage.approvalRequired);
  assert.ok(dbEntry.approvalRequired);
  assert.ok(!searchMsg.approvalRequired);
  assert.ok(!searchPages.approvalRequired);
  console.log('PASS registry + approval + verify methods');

  // HIGH_CONSEQUENCE parity
  for (const a of ['postMessage', 'createChannel', 'inviteUsers']) {
    assert.ok(HIGH_CONSEQUENCE_ACTIONS.slack.includes(a), `slack.${a}`);
    assert.ok(isHighConsequence('slack', a));
  }
  for (const a of ['createPage', 'updatePage', 'createDatabaseEntry']) {
    assert.ok(HIGH_CONSEQUENCE_ACTIONS.notion.includes(a), `notion.${a}`);
    assert.ok(isHighConsequence('notion', a));
  }
  console.log('PASS HIGH_CONSEQUENCE gates');

  // Planner: Slack post / create / search
  {
    const { route, calls } = await planFor('Post to #general on Slack: "Nexora P0.1 Slack verify"');
    assert.ok(route.family === 'slack_write' || route.lockedTool === 'slack' || calls.some((c) => c.tool === 'slack'));
    assert.ok(calls.some((c) => c.tool === 'slack' && c.action === 'postMessage'));
    assert.ok(calls.every((c) => c.tool === 'slack' || c.tool === 'jira')); // no cross-notion leak required
    const postCall = calls.find((c) => c.action === 'postMessage');
    assert.ok(postCall.requiresApproval);
    assert.ok(String(postCall.input.text || '').includes('Nexora P0.1') || String(postCall.input.text || '').length > 0);
  }
  {
    const { calls } = await planFor('Create a new Slack channel called nexora-p01-verify');
    assert.ok(calls.some((c) => c.tool === 'slack' && c.action === 'createChannel'));
    assert.ok(calls.find((c) => c.action === 'createChannel').requiresApproval);
  }
  {
    const { calls } = await planFor('Search messages in Slack for Nexora');
    assert.ok(calls.some((c) => c.tool === 'slack' && (c.action === 'searchMessages' || c.action === 'searchHistory')));
  }
  console.log('PASS Slack planner routing');

  // Planner: Notion create / update / search
  {
    const { route, calls } = await planFor('Create a Notion page called "Nexora P0.1 Notion verify"');
    assert.ok(route.family === 'notion' || route.lockedTool === 'notion' || calls.some((c) => c.tool === 'notion'));
    assert.ok(calls.some((c) => c.tool === 'notion' && c.action === 'createPage'));
    assert.ok(calls.find((c) => c.action === 'createPage').requiresApproval);
  }
  {
    const { calls } = await planFor('Update Notion page "Nexora P0.1 Notion verify" with body "verified live"');
    assert.ok(calls.some((c) => c.tool === 'notion' && c.action === 'updatePage'));
    assert.ok(calls.find((c) => c.action === 'updatePage').requiresApproval);
  }
  {
    const { calls } = await planFor('Search Notion pages for Nexora');
    assert.ok(calls.some((c) => c.tool === 'notion' && c.action === 'searchPages'));
  }
  console.log('PASS Notion planner routing');

  // Scope: Slack write / Notion families include required capabilities
  {
    const route = resolveAuthoritativeRoute('Post to #general on Slack: hello');
    const scope = buildCapabilityScope(route);
    if (route.family === 'slack_write') {
      assert.ok(scope.allowed.has('slack.postMessage'));
      assert.ok(scope.allowed.has('slack.createChannel'));
      assert.ok(scope.allowed.has('slack.inviteUsers'));
      assert.ok(!scope.allowed.has('jira.createIssue'));
    }
  }
  {
    const route = resolveAuthoritativeRoute('Create a Notion page called Test');
    const scope = buildCapabilityScope(route);
    if (route.family === 'notion') {
      assert.ok(scope.allowed.has('notion.createPage'));
      assert.ok(scope.allowed.has('notion.updatePage'));
      assert.ok(scope.allowed.has('notion.createDatabaseEntry'));
      assert.ok(scope.allowed.has('notion.searchPages'));
      assert.ok(!scope.allowed.has('slack.createWarRoom'));
    }
  }
  console.log('PASS capability scopes');

  // Jira must still resolve (no regression smoke)
  {
    const { route, calls } = await planFor('Create a Jira ticket titled Slack Notion parity check');
    assert.strictEqual(route.lockedTool, 'jira');
    assert.strictEqual(route.lockedAction, 'createIssue');
    assert.ok(calls.some((c) => c.tool === 'jira' && c.action === 'createIssue'));
    assert.ok(!calls.some((c) => c.tool === 'slack' || c.tool === 'notion'));
  }
  console.log('PASS Jira no-regression smoke');

  console.log('\nAll Slack/Notion P0.1 expansion checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
