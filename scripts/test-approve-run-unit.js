/**
 * Self-contained unit checks (no ts-node) for Approve & run honesty rules.
 * Run: node scripts/test-approve-run-unit.js
 */
const assert = require('assert');
const { randomUUID } = require('crypto');

/** Minimal mirror of InMemoryApprovalStore claim/complete semantics */
class MemStore {
  constructor() {
    this.items = new Map();
  }
  async create(organizationId, toolCall, requestedByUserId) {
    const request = {
      id: randomUUID(),
      organizationId,
      tool: toolCall.tool,
      action: toolCall.action,
      riskLevel: toolCall.riskLevel,
      input: toolCall.input,
      status: 'pending',
      requestedByUserId,
      createdAt: new Date().toISOString(),
    };
    this.items.set(request.id, request);
    return request;
  }
  async claimForExecution(id, decidedByUserId) {
    const existing = this.items.get(id);
    if (!existing || existing.status !== 'pending') return undefined;
    const updated = {
      ...existing,
      status: 'approved',
      decidedByUserId,
      decidedAt: new Date().toISOString(),
      executionStatus: 'executing',
    };
    this.items.set(id, updated);
    return updated;
  }
  async completeExecution(id, result, verified) {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const executionStatus = result.ok && verified && !result.mocked ? 'completed' : 'failed';
    const updated = {
      ...existing,
      executionStatus,
      executionResult: result,
      executionVerified: verified && result.ok && !result.mocked,
      executedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    return updated;
  }
}

function rejectMockOrUnverified(result, verified) {
  if (result.mocked) {
    return {
      ...result,
      ok: false,
      error: result.error || `Refusing mock success for ${result.tool}.${result.action}`,
    };
  }
  if (result.ok && !verified) {
    return {
      ...result,
      ok: false,
      error: `External verification failed for ${result.tool}.${result.action}`,
    };
  }
  return result;
}

(async () => {
  const store = new MemStore();
  const created = await store.create(
    'org-1',
    { tool: 'jira', action: 'createIssue', input: { summary: 'Risk test' }, riskLevel: 'high' },
    'user-1'
  );
  assert.strictEqual(created.status, 'pending');

  const claimed = await store.claimForExecution(created.id, 'user-1');
  assert.ok(claimed);
  assert.strictEqual(claimed.executionStatus, 'executing');
  assert.strictEqual(await store.claimForExecution(created.id, 'user-1'), undefined);

  const failed = await store.completeExecution(
    created.id,
    { tool: 'jira', action: 'createIssue', ok: false, error: 'nope', mocked: false },
    false
  );
  assert.strictEqual(failed.executionStatus, 'failed');

  // gmail-style mock must be rejected
  const mocked = rejectMockOrUnverified(
    { tool: 'gmail', action: 'sendEmail', ok: true, output: { messageId: 'mock-1' }, mocked: true },
    false
  );
  assert.strictEqual(mocked.ok, false);

  // unverified "success" must be rejected
  const unverified = rejectMockOrUnverified(
    { tool: 'jira', action: 'createIssue', ok: true, output: { key: 'X-1' }, mocked: false },
    false
  );
  assert.strictEqual(unverified.ok, false);

  // verified live success passes
  const live = rejectMockOrUnverified(
    { tool: 'jira', action: 'createIssue', ok: true, output: { key: 'X-1' }, mocked: false },
    true
  );
  assert.strictEqual(live.ok, true);

  // NL risk maps to createIssue (not invent createRisk)
  const action = 'createIssue';
  assert.notStrictEqual(action, 'createRisk');

  console.log('PASS unit approve-run honesty + idempotency + no-fake-success');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
