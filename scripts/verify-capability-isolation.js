#!/usr/bin/env node
/**
 * P0.2 — Capability isolation regressions.
 * Application-owned scope checks; no external API calls.
 *
 * Run: node scripts/verify-capability-isolation.js
 */
const assert = require('assert');
const path = require('path');

const {
  resolveAuthoritativeRoute,
  filterToolCallsByFamily,
  toolCallFromRoute,
  buildCapabilityScope,
  validateCapabilityExecution,
  stampCapabilityContext,
  filterCallsByCapabilityScope,
  getCapability,
  listCapabilities,
  capabilityName,
} = require(path.join(__dirname, '../packages/agent-core/dist/os'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));

function inject(tool, action) {
  return {
    tool,
    action,
    input: {},
    riskLevel: 'high',
    requiresApproval: true,
  };
}

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
  return { route, calls, stripped: filtered.stripped };
}

async function main() {
  // Registry sanity
  assert.ok(getCapability('jira', 'createIssue'));
  assert.strictEqual(getCapability('jira', 'createIssue').approvalRequired, true);
  assert.ok(getCapability('slack', 'createWarRoom'));
  assert.ok(getCapability('notion', 'createPage'));
  assert.ok(!getCapability('jira', 'inventedAction'));
  console.log('PASS registry exists for real connectors only');

  // TEST 1 — Create a Jira ticket
  {
    const { route, calls, stripped } = await planFor('Create a Jira ticket');
    assert.strictEqual(route.lockedTool, 'jira');
    assert.strictEqual(route.lockedAction, 'createIssue');
    assert.ok(calls.every((c) => c.tool === 'jira'));
    assert.ok(calls.some((c) => c.action === 'createIssue'));
    assert.ok(!calls.some((c) => c.tool === 'slack' || c.tool === 'notion'));
    const scope = buildCapabilityScope(route);
    assert.ok(scope.allowed.has('jira.createIssue'));
    assert.ok(scope.allowed.has('jira.searchIssues'));
    assert.ok(!scope.allowed.has('slack.createWarRoom'));
    assert.ok(!scope.allowed.has('slack.createIncident'));
    assert.ok(!scope.allowed.has('notion.createPage'));
    const injectWar = filterCallsByCapabilityScope([inject('slack', 'createWarRoom')], scope);
    assert.strictEqual(injectWar.kept.length, 0);
    assert.strictEqual(injectWar.stripped[0].reason, 'CAPABILITY_NOT_ALLOWED');
    console.log('PASS TEST1 jira.createIssue scope excludes Slack/Notion');
  }

  // TEST 2 — Create a Slack message
  {
    const { route, calls } = await planFor('Post to #ops on Slack: standup summary ready');
    assert.ok(calls.some((c) => c.tool === 'slack' && c.action === 'postMessage'));
    const scope = buildCapabilityScope(route);
    assert.ok(!scope.allowed.has('jira.createIssue'));
    assert.ok(!scope.allowed.has('notion.createPage'));
    const bad = filterCallsByCapabilityScope(
      [inject('jira', 'createIssue'), inject('notion', 'createPage')],
      scope
    );
    assert.strictEqual(bad.kept.length, 0);
    console.log('PASS TEST2 slack.postMessage scope excludes Jira/Notion');
  }

  // TEST 3 — Create a Notion page
  {
    const { route, calls } = await planFor('Create a Notion page called Investor Notes');
    assert.ok(calls.some((c) => c.tool === 'notion' && c.action === 'createPage'));
    const scope = buildCapabilityScope(route);
    assert.ok(!scope.allowed.has('jira.createIssue'));
    assert.ok(!scope.allowed.has('slack.createWarRoom'));
    console.log('PASS TEST3 notion.createPage scope excludes Jira/Slack war room');
  }

  // TEST 4 — Direct out-of-scope request (jira intent, slack war room)
  {
    const route = resolveAuthoritativeRoute('Create a vendor Jira ticket');
    const scope = buildCapabilityScope(route);
    const stamped = stampCapabilityContext(inject('slack', 'createWarRoom'), route);
    // Force war room into a jira-stamped call (adversarial)
    stamped.tool = 'slack';
    stamped.action = 'createWarRoom';
    const gate = validateCapabilityExecution(stamped, scope);
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.code, 'CAPABILITY_NOT_ALLOWED');
    console.log('PASS TEST4 out-of-scope slack.createWarRoom REJECTED');
  }

  // TEST 5 — Stale action from another conversation (wrong stamp)
  {
    const jiraRoute = resolveAuthoritativeRoute('Create a Jira ticket for vendor onboarding');
    const slackRoute = resolveAuthoritativeRoute('Post to #ops on Slack: hello');
    const stale = stampCapabilityContext(inject('slack', 'postMessage'), slackRoute);
    // Replay into jira scope
    const jiraScope = buildCapabilityScope(jiraRoute);
    const gate = validateCapabilityExecution(stale, jiraScope);
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.code, 'CAPABILITY_NOT_ALLOWED');
    console.log('PASS TEST5 stale cross-conversation capability REJECTED');
  }

  // TEST 6 — Malformed / unknown capability (registered tools still reject unknown actions)
  {
    const gate = validateCapabilityExecution(inject('jira', 'totallyFakeAction'));
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.code, 'CAPABILITY_UNKNOWN');
    const gmailFake = validateCapabilityExecution(inject('gmail', 'totallyFakeAction'));
    assert.strictEqual(gmailFake.ok, false);
    assert.strictEqual(gmailFake.code, 'CAPABILITY_UNKNOWN');
    console.log('PASS TEST6 malformed/unknown capability REJECTED');
  }

  // Adversarial NL variants → jira when locked; never war room / never Slack execute
  const variants = [
    'Create a vendor Jira ticket.',
    'Can you open an issue in Jira for vendor onboarding?',
    'I need a Jira issue for this vendor problem.',
  ];
  for (const q of variants) {
    const { route, calls } = await planFor(q);
    assert.ok(!calls.some((c) => c.tool === 'slack' || c.action === 'createWarRoom'), q);
    if (route.family === 'jira' || route.lockedTool === 'jira') {
      assert.ok(calls.every((c) => c.tool === 'jira'), q);
    } else {
      // Ambiguous phrasing may clarify — still must not execute Slack/Notion
      assert.ok(route.mode === 'clarify' || route.ambiguous || calls.length === 0, q);
    }
  }
  console.log('PASS adversarial jira NL variants (no Slack leakage)');

  // Multi-tool ask must not improvise — clarify or locked single family
  {
    const { route, calls } = await planFor('Make the Jira ticket and notify Slack.');
    if (route.mode === 'clarify' || route.ambiguous) {
      assert.strictEqual(calls.length, 0);
      console.log('PASS multi-tool ask clarified (no improvised dual execute)');
    } else if (route.lockedTool === 'jira') {
      assert.ok(calls.every((c) => c.tool === 'jira'));
      assert.ok(!calls.some((c) => c.tool === 'slack'));
      console.log('PASS multi-tool ask locked to jira only (Slack not exposed)');
    } else {
      throw new Error(`Unexpected multi-tool handling: ${JSON.stringify(route)}`);
    }
  }

  // Inject war room into jira family filter
  {
    const route = resolveAuthoritativeRoute('Create a Jira ticket');
    const filtered = filterToolCallsByFamily(
      [inject('jira', 'createIssue'), inject('slack', 'createWarRoom'), inject('notion', 'createPage')],
      route.family,
      route
    );
    assert.ok(filtered.kept.every((c) => c.tool === 'jira'));
    assert.ok(filtered.stripped.some((s) => s.tool === 'slack' && /capability|locked/i.test(s.reason)));
    assert.ok(filtered.stripped.some((s) => s.tool === 'notion'));
    console.log('PASS injected cross-tool plan stripped by capability filter');
  }

  console.log('SUMMARY all capability isolation tests passed');
  console.log('capabilities_registered', listCapabilities().length);
  console.log('sample', capabilityName('jira', 'createIssue'));
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
