/**
 * P0.3.5 — Chat continuity + approval conversation linking (unit checks).
 * Does not hit live production APIs.
 */
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function main() {
  const { computeApprovalFingerprint, bindingPayload } = require('../packages/agent-core/dist/os/approvalIntegrity.js');
  const { InMemoryApprovalStore } = require('../packages/agent-core/dist/approvals.js');
  const {
    formatApprovalExecutionMessage,
  } = require('../packages/agent-core/dist/conversationResults.js');

  // Continuity keys must not affect fingerprint
  const base = {
    summary: 'Nexora P0.3.5 Continuity Test',
    project: 'ABC',
    _intentFamily: 'jira',
    _capabilityScope: ['jira.createIssue'],
    _lockedCapability: 'jira.createIssue',
  };
  const withConv = { ...base, _conversationId: 'conv-111', _goal: 'Create ticket', _understood: 'Jira create' };
  const fp1 = computeApprovalFingerprint('jira', 'createIssue', base);
  const fp2 = computeApprovalFingerprint('jira', 'createIssue', withConv);
  assert(fp1 === fp2, 'conversation continuity metadata must not change fingerprint');
  assert(!('_conversationId' in bindingPayload(withConv)), 'bindingPayload strips _conversationId');

  const store = new InMemoryApprovalStore();
  const approval = await store.create(
    'org-1',
    { tool: 'jira', action: 'createIssue', input: withConv, riskLevel: 'high', requiresApproval: true },
    'user-1',
    { conversationId: 'conv-111' }
  );
  assert(approval.conversationId === 'conv-111', 'approval stores conversationId');
  const got = await store.get(approval.id);
  assert(got?.conversationId === 'conv-111', 'approval get returns conversationId');

  const msg = formatApprovalExecutionMessage(
    { ...approval, executionVerified: true },
    {
      tool: 'jira',
      action: 'createIssue',
      ok: true,
      mocked: false,
      output: { key: 'ABC-123', url: 'https://example.atlassian.net/browse/ABC-123' },
    }
  );
  assert(/ABC-123/.test(msg), 'result message includes issue key');
  assert(/Verified/.test(msg), 'result message includes verification line');
  assert(/✓/.test(msg), 'success message uses check mark');

  console.log('PASS conversation continuity metadata ignored by fingerprint');
  console.log('PASS approval.conversationId persisted in memory store');
  console.log('PASS durable execution message format');
  console.log('SUMMARY P0.3.5 continuity unit checks passed');
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
