/**
 * Part 5 — Jarvis work-assistant NL routing regressions.
 * Run: node scripts/verify-jarvis-work-assistant.js
 * (requires packages/agent-core build)
 */
const path = require('path');
const {
  resolveAuthoritativeRoute,
  toolCallFromRoute,
} = require('../packages/agent-core/dist/os/routingPolicy.js');
const {
  isJiraReadQuery,
  isGmailSoftReadQuery,
  isSlackSoftReadQuery,
  expandGmailFollowUp,
  jiraSearchFlags,
} = require('../packages/agent-core/dist/os/workAssistantIntent.js');
const { buildGmailSearchQuery } = require('../packages/agent-core/dist/os/gmailQuery.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok ', msg);
  }
}

// --- Detectors ---
assert(isJiraReadQuery("What's pending in Jira?"), 'jira pending');
assert(isJiraReadQuery('Which tasks are overdue?'), 'overdue tasks');
assert(isJiraReadQuery('What do I need to finish today?'), 'finish today');
assert(isGmailSoftReadQuery('Do I have anything urgent from my manager?'), 'manager urgent');
assert(isSlackSoftReadQuery("What's happening in the engineering team?"), 'eng team pulse');
assert(isSlackSoftReadQuery('Find the conversation where we discussed the Acme issue.'), 'find conversation');

// --- Routes ---
const cases = [
  ["What's pending in Jira?", 'jira', 'searchIssues'],
  ['Which tasks are overdue?', 'jira', 'searchIssues'],
  ['What do I need to finish today?', 'jira', 'searchIssues'],
  ['Show me my important emails.', 'gmail', 'searchEmails'],
  ['Do I have anything urgent from my manager?', 'gmail', 'searchEmails'],
  ['Create a Jira ticket for the login bug.', 'jira', 'createIssue'],
  ['Send this update to #engineering on slack', 'slack', null],
  ["What's important today?", 'gmail', 'searchEmails'],
  ['What should I work on first?', 'jira', 'searchIssues'],
  ['Find the project documentation.', 'notion', 'searchPages'],
  ['Find the latest project issue in Slack and create a Jira ticket.', null, null],
];

const { impliesLiveWorkspaceData } = require('../packages/agent-core/dist/os/workAssistantIntent.js');
assert(impliesLiveWorkspaceData("What's important today?"), 'work pulse implies live data');
assert(impliesLiveWorkspaceData('Find the project documentation.'), 'notion doc implies live data');

for (const [q, tool, action] of cases) {
  const r = resolveAuthoritativeRoute(q);
  assert(r.mode === 'execute', `${q} → execute (got ${r.mode})`);
  if (tool) assert(r.lockedTool === tool, `${q} → tool=${r.lockedTool} want ${tool}`);
  if (action) assert(r.lockedAction === action, `${q} → action=${r.lockedAction} want ${action}`);
  const call = toolCallFromRoute(r, q);
  if (action) assert(call?.action === action, `${q} → toolCall ${call?.action}`);
  if (q.includes('Slack and create a Jira')) {
    assert(r.allowWorkflow === true, `${q} → cross-tool workflow`);
  }
}

const overdue = toolCallFromRoute(resolveAuthoritativeRoute('Which tasks are overdue?'), 'Which tasks are overdue?');
assert(overdue?.input?.overdueOnly === true, 'overdueOnly flag');

const flags = jiraSearchFlags("What's pending in Jira?");
assert(flags.pendingOnly === true, 'pendingOnly flag');

assert(buildGmailSearchQuery('urgent from my manager').includes('is:important') || buildGmailSearchQuery('urgent from my manager').includes('manager'), 'manager gmail q');

// Follow-up expansion
const mem = {
  query: 'Find emails from Rahul',
  gmailQuery: 'from:Rahul',
  emails: [
    { id: 'm1', subject: 'One' },
    { id: 'm2', subject: 'Two' },
  ],
};
const week = expandGmailFollowUp('Only the ones from this week.', mem);
assert(/Rahul/i.test(week.query) && /this week/i.test(week.query), 'follow-up week merges prior');
const second = expandGmailFollowUp('Summarize the second one.', mem);
assert(second.getEmailId === 'm2', 'follow-up second email id');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll Jarvis work-assistant checks passed.');
