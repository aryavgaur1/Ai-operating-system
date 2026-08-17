#!/usr/bin/env node
/**
 * P0.4 — Execution core: destination vs reference routing, Notion content, dry-run.
 * Run after: npm run build -w @enterprise-ai-os/agent-core
 *   node scripts/verify-p04-execution-core.js
 */
const assert = require('assert');
const path = require('path');

process.env.SAAS_MODE = 'false';
delete process.env.DATABASE_URL;

const dist = path.join(__dirname, '../packages/agent-core/dist');
const {
  resolveAuthoritativeRoute,
  filterToolCallsByFamily,
  toolCallFromRoute,
  stampCapabilityContext,
  resolveNotionCreateBody,
  buildNotionDraftBody,
} = require(dist);
const { buildPlan } = require(path.join(dist, 'planner'));

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

function pass(name) {
  console.log(`PASS ${name}`);
}

async function main() {
  // —— GOLDEN routing: Slack dest, Notion reference ——
  {
    const q = 'Post a Slack update about the Notion integration test in #general.';
    const { route, calls } = await planFor(q);
    assert.strictEqual(route.lockedTool, 'slack', `expected slack, got ${route.lockedTool} / ${route.family}`);
    assert.ok(route.family === 'slack_write' || route.family === 'slack_read');
    assert.ok(calls.some((c) => c.tool === 'slack' && c.action === 'postMessage'), JSON.stringify(calls));
    assert.ok(!calls.some((c) => c.tool === 'notion'), 'must not select notion');
    assert.ok(!calls.some((c) => c.tool === 'jira'), 'must not select jira');
    pass('Slack post about Notion → slack.postMessage only');
  }

  // —— Jira dest, Slack reference ——
  {
    const q = 'Create a Jira ticket about the Slack integration failure.';
    const { route, calls } = await planFor(q);
    assert.strictEqual(route.lockedTool, 'jira');
    assert.ok(calls.some((c) => c.tool === 'jira' && c.action === 'createIssue'));
    assert.ok(!calls.some((c) => c.tool === 'slack'));
    pass('Jira ticket about Slack → jira.createIssue only');
  }

  // —— Notion dest, Slack reference ——
  {
    const q = 'Create a Notion page documenting our Slack integration.';
    const { route, calls } = await planFor(q);
    assert.strictEqual(route.lockedTool, 'notion', `got ${route.lockedTool} ${route.family}`);
    assert.ok(calls.some((c) => c.tool === 'notion' && /create/i.test(c.action)));
    assert.ok(!calls.some((c) => c.tool === 'slack' && c.action === 'postMessage'));
    pass('Notion page documenting Slack → notion create only');
  }

  // —— Slack read, Jira reference ——
  {
    const q = 'Find Slack messages about our Jira delay.';
    const { route, calls } = await planFor(q);
    assert.ok(
      route.family === 'slack_read' || route.lockedTool === 'slack',
      `expected slack read, got ${route.family}/${route.lockedTool}`
    );
    assert.ok(!calls.some((c) => c.tool === 'jira'));
    assert.ok(!calls.some((c) => c.tool === 'slack' && c.action === 'postMessage'));
    pass('Find Slack messages about Jira → slack read, not jira');
  }

  // —— Dry run: no writes ——
  {
    const q = "Don't execute anything. Tell me what you would do.";
    const { route, calls } = await planFor(q);
    assert.ok(route.mode === 'dry_run' || route.mode === 'clarify' || route.family === 'meta');
    const writes = calls.filter((c) =>
      /create|post|update|delete|send|invite/i.test(c.action)
    );
    assert.strictEqual(writes.length, 0, `dry-run must not propose writes: ${JSON.stringify(writes)}`);
    pass('Dry-run / don’t execute → no write tools');
  }

  // —— Notion body must not echo command ——
  {
    const q = 'Create a Notion page called Nexora OS.';
    const { calls } = await planFor(q);
    const create = calls.find((c) => c.tool === 'notion' && c.action === 'createPage');
    assert.ok(create, 'expected createPage');
    const body = String(create.input.body || '');
    assert.ok(body.length > 40, 'body should be substantial draft');
    assert.ok(!/^create a notion page/i.test(body.trim()), 'body must not be the raw command');
    assert.ok(body.toLowerCase() !== q.toLowerCase(), 'body must not equal query');
    assert.ok(/overview|capabilities|architecture/i.test(body), 'draft should have useful structure');
    assert.ok(/AI-generated/i.test(body), 'draft should be labeled AI-generated');
    pass('Notion create Nexora OS → structured draft, not command echo');
  }

  // —— User-provided bullet content preserved ——
  {
    const q =
      'Create a Notion page called Vendor Onboarding and include:\n- process\n- owners\n- SLA\n- checklist';
    const body = resolveNotionCreateBody(q, 'Vendor Onboarding');
    assert.ok(/process/i.test(body) && /owners/i.test(body) && /SLA/i.test(body));
    assert.ok(body.toLowerCase() !== q.toLowerCase());
    pass('Notion with explicit bullets uses user content');
  }

  // —— Draft helper unit ——
  {
    const draft = buildNotionDraftBody({ title: 'Nexora OS', query: 'Create a Notion page called Nexora OS.' });
    assert.ok(!draft.includes('Create a Notion page called Nexora OS.'));
    assert.ok(/Core capabilities/i.test(draft));
    pass('buildNotionDraftBody never echoes command');
  }

  // —— Continuity: approval conversation metadata still stripped (regression) ——
  {
    const { computeApprovalFingerprint, bindingPayload } = require(path.join(dist, 'os/approvalIntegrity.js'));
    const base = { summary: 'x', project: 'ABC', _intentFamily: 'jira' };
    const withConv = { ...base, _conversationId: 'c1', _goal: 'g' };
    assert.strictEqual(
      computeApprovalFingerprint('jira', 'createIssue', base),
      computeApprovalFingerprint('jira', 'createIssue', withConv)
    );
    assert.ok(!('_conversationId' in bindingPayload(withConv)));
    pass('Approval fingerprint ignores conversation continuity keys');
  }

  console.log('SUMMARY P0.4 execution-core checks passed');
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
