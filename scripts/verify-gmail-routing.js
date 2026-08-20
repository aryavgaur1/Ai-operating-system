/**
 * Regression checks for Gmail NL → route → Gmail q.
 * Run: node scripts/verify-gmail-routing.js
 */
const {
  resolveAuthoritativeRoute,
  toolCallFromRoute,
} = require('../packages/agent-core/dist/os/routingPolicy.js');
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

const cases = [
  ['Find my top priority emails.', 'gmail_read', 'searchEmails', 'is:important'],
  ['Show my unread emails.', 'gmail_read', 'searchEmails', 'is:unread'],
  ['Find emails from Rahul.', 'gmail_read', 'searchEmails', 'from:Rahul'],
  ['Find emails about the investor meeting.', 'gmail_read', 'searchEmails', 'investor meeting'],
  ['Show emails from the last 7 days.', 'gmail_read', 'searchEmails', 'newer_than:7d'],
  ['Find emails with attachments.', 'gmail_read', 'searchEmails', 'has:attachment'],
  ['What are my top priority emails?', 'gmail_read', 'searchEmails', 'is:important'],
  ['Find emails from my college.', 'gmail_read', 'searchEmails', 'college'],
  ['Send an email to alice@example.com about the launch', 'gmail_write', 'sendEmail', null],
];

for (const [q, family, action, qPart] of cases) {
  const r = resolveAuthoritativeRoute(q);
  assert(r.family === family, `${q} → family=${r.family} (want ${family})`);
  assert(r.lockedTool === 'gmail', `${q} → lockedTool gmail`);
  assert(r.lockedAction === action, `${q} → action=${r.lockedAction}`);
  assert(r.mode === 'execute', `${q} → mode execute`);
  const call = toolCallFromRoute(r, q);
  if (action === 'searchEmails') {
    const gq = String(call?.input?.query || '');
    assert(gq.includes(qPart), `${q} → gmail q "${gq}" includes "${qPart}"`);
    assert(!gq.includes('from:last'), `${q} → must not invent from:last`);
    assert(!gq.includes('from:college'), `${q} → must not invent from:college`);
  }
  if (action === 'sendEmail') {
    assert(call?.input?.to === 'alice@example.com', `${q} → real recipient`);
  }
}

assert(buildGmailSearchQuery('emails from the last 3 days').includes('newer_than:3d'), 'newer_than:3d');
assert(!buildGmailSearchQuery('emails from the last 3 days').includes('from:'), 'no from on last N days');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll Gmail routing checks passed.');
