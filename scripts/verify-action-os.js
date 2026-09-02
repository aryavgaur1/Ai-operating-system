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
  workflowPlanReply,
} = require(path.join(__dirname, '../packages/agent-core/dist/os/routingPolicy'));
const { planWorkflow } = require(path.join(__dirname, '../packages/agent-core/dist/os/workflowPlanner'));
const {
  isActionMutationQuery,
  impliesWorkspaceExecution,
  shouldSkipHybridRetrieve,
  isActionRouteIntent,
} = require(path.join(__dirname, '../packages/agent-core/dist/os/workAssistantIntent'));
const { extractActionOutcomes } = require(path.join(__dirname, '../packages/agent-core/dist/os/actionOutcomes'));
const { buildPlan } = require(path.join(__dirname, '../packages/agent-core/dist/planner'));

const EMPTY_CTX = { vectorMatches: [], graph: { nodes: [], edges: [] }, keywordMatches: [] };

async function planFor(query) {
  const route = resolveAuthoritativeRoute(query);
  const llm = { async complete() { return 'draft'; } };
  const plan = await buildPlan(
    query,
    { intent: 'action', confidence: 0.9, rationale: route.rationale },
    EMPTY_CTX,
    llm,
    route
  );
  const filtered = filterToolCallsByFamily(plan.toolCalls, route.family, route);
  let calls = filtered.kept;
  if (route.lockedTool && route.lockedAction && calls.length === 0 && route.mode === 'execute') {
    const locked = toolCallFromRoute(route, query);
    if (locked) calls = [locked];
  }
  return { route, calls, plan };
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

  const warRoute = resolveAuthoritativeRoute('Create a launch war room.');
  ok('war room skip hybrid retrieve', shouldSkipHybridRetrieve(warRoute, 'Create a launch war room.'));
  ok('war room is action route intent', isActionRouteIntent(warRoute, 'Create a launch war room.'));

  const war = await planFor('Create a launch war room for Project Atlas on slack');
  ok('war room mode execute', war.route.mode === 'execute');
  ok('war room locks slack', war.route.lockedTool === 'slack' || war.calls.some((c) => c.tool === 'slack'));

  const warWf = planWorkflow('Create a launch war room.', warRoute.osIntent);
  ok('workflow has createWarRoom', warWf.toolCalls.some((c) => c.action === 'createWarRoom'));
  const wfReply = workflowPlanReply(warWf);
  ok('workflow reply is action proposed', /Action proposed/i.test(wfReply));
  ok('workflow reply not VC pitch', !/VC|pitch deck|investor meeting/i.test(wfReply));

  let llmCalled = false;
  const jiraRoute = resolveAuthoritativeRoute('Create a Jira ticket for the payment bug.');
  const jiraPlan = await buildPlan(
    'Create a Jira ticket for the payment bug.',
    { intent: 'action', confidence: 0.95, rationale: jiraRoute.rationale },
    EMPTY_CTX,
    {
      async complete() {
        llmCalled = true;
        return 'Here is a pitch you could give to a VC about payment systems.';
      },
    },
    jiraRoute
  );
  ok('locked jira skips LLM draft', !llmCalled);
  ok('jira draft not VC pitch', !/VC|pitch/i.test(jiraPlan.responseDraft));

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

  const capitalRoute = resolveAuthoritativeRoute('What is the capital of France?');
  ok('capital not action route', !isActionRouteIntent(capitalRoute, 'What is the capital of France?'));
  ok('capital not action mutation', !isActionMutationQuery('What is the capital of France?'));

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

  const nestedWarRoom = extractActionOutcomes(
    [
      {
        tool: 'slack',
        action: 'createWarRoom',
        ok: true,
        mocked: false,
        output: {
          workflow: 'createWarRoom',
          channel: {
            id: 'C01234567',
            name: 'launch-war-room',
            url: 'https://slack.com/app_redirect?channel=C01234567',
          },
        },
      },
    ],
    [{ tool: 'slack', action: 'createWarRoom', input: {}, riskLevel: 'high', requiresApproval: true }],
    []
  );
  ok('nested war room url', nestedWarRoom[0].resourceUrl?.includes('C01234567'));
  ok('nested war room name', nestedWarRoom[0].resource === '#launch-war-room');

  const failedOutcome = extractActionOutcomes(
    [{ tool: 'slack', action: 'createWarRoom', ok: false, mocked: false, error: 'Slack is not connected.' }],
    [{ tool: 'slack', action: 'createWarRoom', input: {}, riskLevel: 'high', requiresApproval: true }],
    []
  );
  ok('failed outcome status', failedOutcome[0].status === 'failed');
  ok('failed outcome surfaces error', /not connected/i.test(failedOutcome[0].summary || ''));

  console.log('\nAll Action OS checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
