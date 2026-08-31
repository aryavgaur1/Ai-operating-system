#!/usr/bin/env node
/**
 * Action OS regressions — mutation routing, no LLM fallthrough, resource outcomes.
 * Run: npm run build -w packages/shared -w packages/agent-core && node scripts/verify-action-os.js
 */
const assert = require('assert');
const path = require('path');

const {
  wantsWorkspaceTools,
} = require(path.join(__dirname, '../packages/agent-core/dist/aiService/index'));
const {
  resolveAuthoritativeRoute,
  detectRequestMode,
  toolCallFromRoute,
  filterToolCallsByFamily,
} = require(path.join(__dirname, '../packages/agent-core/dist/os/routingPolicy'));
const {
  isActionMutationQuery,
  impliesWorkspaceExecution,
} = require(path.join(__dirname, '../packages/agent-core/dist/os/workAssistantIntent'));
const { extractActionOutcomes } = require(path.join(__dirname, '../packages/agent-core/dist/os/actionOutcomes'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));

async function planFor(query) {
  const route = resolveAuthoritativeRoute(query);
  const llm = { async complete() { return 'draft'; } };
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
  return { route, calls };
}

function ok(label, cond) {
  assert.ok(cond, label);
  console.log('ok ', label);
}

async function main() {
  ok('war room is action mutation', isActionMutationQuery('Create a launch war room for the Q4 launch.'));
  ok('jira create is action mutation', isActionMutationQuery('Create a Jira ticket for the payment bug.'));
  ok('notion create is action mutation', isActionMutationQuery('Create a Notion page for this project.'));
  ok('gmail send is action mutation', isActionMutationQuery('Send an email to alice@example.com about the launch'));
  ok('gmail read is workspace execution', impliesWorkspaceExecution('Find my important emails.'));
  ok('wantsWorkspaceTools for war room', wantsWorkspaceTools('Create a launch war room.'));

  ok('war room routes execute', detectRequestMode('Create a launch war room?') === 'execute');

  const war = await planFor('Create a launch war room for Project Atlas on slack');
  ok('war room mode execute', war.route.mode === 'execute');
  ok('war room locks slack', war.route.lockedTool === 'slack' || war.calls.some((c) => c.tool === 'slack'));

  const jira = await planFor('Create a Jira ticket for the login bug.');
  ok('jira ticket mode execute', jira.route.mode === 'execute');
  ok('jira ticket locks jira', jira.route.lockedTool === 'jira');
  ok('jira ticket action createIssue', jira.route.lockedAction === 'createIssue' || jira.calls.some((c) => c.action === 'createIssue'));
  ok('jira not slack', !jira.calls.some((c) => c.tool === 'slack'));

  const notion = await planFor('Create a Notion page titled Project Launch Plan');
  ok('notion page mode execute', notion.route.mode === 'execute');
  ok('notion locks notion', notion.route.lockedTool === 'notion' || notion.calls.some((c) => c.tool === 'notion'));

  const gmail = await planFor('Find my important emails.');
  ok('gmail read locks gmail', gmail.route.lockedTool === 'gmail');
  ok('gmail read searchEmails', gmail.route.lockedAction === 'searchEmails');

  const outcomes = extractActionOutcomes(
    [
      {
        tool: 'jira',
        action: 'createIssue',
        ok: true,
        mocked: false,
        output: { key: 'NEX-123', url: 'https://example.atlassian.net/browse/NEX-123' },
      },
      {
        tool: 'slack',
        action: 'createWarRoom',
        ok: true,
        mocked: false,
        output: { name: 'q4-launch', url: 'https://workspace.slack.com/archives/C012345' },
      },
    ],
    [
      { tool: 'jira', action: 'createIssue', input: {}, riskLevel: 'high', requiresApproval: true },
      { tool: 'slack', action: 'createWarRoom', input: {}, riskLevel: 'high', requiresApproval: true },
    ],
    []
  );
  ok('outcomes count', outcomes.length === 2);
  ok('jira outcome url', outcomes[0].resourceUrl?.includes('NEX-123'));
  ok('slack outcome url', outcomes[1].resourceUrl?.includes('slack.com'));

  console.log('\nAll Action OS checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
