#!/usr/bin/env node
/**
 * P0.3 — Approval integrity regressions (no live connector calls).
 * Run: node scripts/verify-approval-integrity.js
 */
const assert = require('assert');
const path = require('path');

// Force in-memory before loading store consumers
process.env.SAAS_MODE = 'false';
delete process.env.DATABASE_URL;

const {
  useInMemoryApprovalStoreForTests,
  resetApprovalStoreForTests,
  executeApprovedAction,
  computeApprovalFingerprint,
  assertApprovalAuthorized,
  assertApprovalExecutable,
  ApprovalIntegrityError,
  stampCapabilityContext,
  resolveAuthoritativeRoute,
  isApprovalExpired,
} = require(path.join(__dirname, '../packages/agent-core/dist'));

function jiraCall(overrides = {}) {
  const route = resolveAuthoritativeRoute('Create a Jira ticket for vendor follow-up');
  const base = {
    tool: 'jira',
    action: 'createIssue',
    input: {
      summary: 'Vendor contract follow-up',
      project: 'KAN',
      projectKey: 'KAN',
    },
    riskLevel: 'high',
    requiresApproval: true,
  };
  const stamped = stampCapabilityContext({ ...base, ...overrides, input: { ...base.input, ...(overrides.input || {}) } }, route);
  return stamped;
}

function results() {
  return { pass: 0, fail: 0, lines: [] };
}

async function main() {
  resetApprovalStoreForTests();
  const store = useInMemoryApprovalStoreForTests();
  const out = [];

  function pass(name) {
    out.push(`PASS ${name}`);
    console.log(`PASS ${name}`);
  }
  function fail(name, err) {
    out.push(`FAIL ${name}: ${err}`);
    console.error(`FAIL ${name}`, err);
    throw err instanceof Error ? err : new Error(String(err));
  }

  // TEST 1 — Create Jira approval with binding
  {
    const call = jiraCall();
    const a = await store.create('org-1', call, 'user-1');
    assert.strictEqual(a.tool, 'jira');
    assert.strictEqual(a.action, 'createIssue');
    assert.ok(a.payloadFingerprint);
    assert.ok(a.expiresAt);
    assert.strictEqual(a.requestedByUserId, 'user-1');
    assert.ok(Array.isArray(a.input._capabilityScope));
    assert.ok(a.input._capabilityScope.includes('jira.createIssue'));
    assert.strictEqual(
      a.payloadFingerprint,
      computeApprovalFingerprint(a.tool, a.action, a.input)
    );
    pass('TEST 1 create Jira approval with exact binding');
  }

  // TEST 2 — Modify payload after claim → reject, no connector
  {
    resetApprovalStoreForTests();
    const store2 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store2.create('org-1', call, 'user-1');
    const claimed = await store2.claimForExecution(a.id, 'user-1');
    assert.ok(claimed);
    // Tamper payload without updating fingerprint (simulates DB/API bypass)
    const row = await store2.get(a.id);
    row.input = { ...row.input, summary: 'TAMPERED SUMMARY' };
    // fingerprint unchanged → integrity fail
    const result = await executeApprovedAction(a.id);
    assert.ok(result);
    assert.strictEqual(result.ok, false);
    assert.ok(/APPROVAL_PAYLOAD_CHANGED/.test(String(result.error)));
    assert.strictEqual(result.mocked, false);
    pass('TEST 2 payload tamper rejected (no connector success)');
  }

  // TEST 3 — Change capability stamps toward Slack scope → reject
  {
    resetApprovalStoreForTests();
    const store3 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store3.create('org-1', call, 'user-1');
    await store3.claimForExecution(a.id, 'user-1');
    const row = await store3.get(a.id);
    row.input = {
      ...row.input,
      _capabilityScope: ['slack.createWarRoom', 'slack.postMessage'],
      _intentFamily: 'slack_write',
      _lockedCapability: 'slack.createWarRoom',
    };
    // Keep old fingerprint → payload/scope change detected
    const result = await executeApprovedAction(a.id);
    assert.ok(result);
    assert.strictEqual(result.ok, false);
    assert.ok(/APPROVAL_PAYLOAD_CHANGED|APPROVAL_SCOPE_CHANGED|CAPABILITY/.test(String(result.error)));
    pass('TEST 3 capability/scope tamper rejected');
  }

  // TEST 4 — Connector/tool field tamper
  {
    resetApprovalStoreForTests();
    const store4 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store4.create('org-1', call, 'user-1');
    await store4.claimForExecution(a.id, 'user-1');
    const row = await store4.get(a.id);
    row.tool = 'slack';
    row.action = 'createWarRoom';
    const result = await executeApprovedAction(a.id);
    assert.ok(result);
    assert.strictEqual(result.ok, false);
    assert.ok(/APPROVAL_PAYLOAD_CHANGED|CAPABILITY/.test(String(result.error)));
    pass('TEST 4 connector/action tamper rejected');
  }

  // TEST 5 — Unauthorized user
  {
    resetApprovalStoreForTests();
    const store5 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store5.create('org-1', call, 'user-1');
    try {
      assertApprovalAuthorized(a, { id: 'user-2', organizationId: 'org-1', role: 'member' });
      fail('TEST 5', 'expected unauthorized');
    } catch (err) {
      assert.ok(err instanceof ApprovalIntegrityError);
      assert.strictEqual(err.code, 'APPROVAL_NOT_AUTHORIZED');
      pass('TEST 5 unauthorized user rejected');
    }
    // Admin allowed
    assertApprovalAuthorized(a, { id: 'admin-1', organizationId: 'org-1', role: 'admin' });
    // Wrong org rejected
    try {
      assertApprovalAuthorized(a, { id: 'user-1', organizationId: 'org-OTHER', role: 'member' });
      fail('TEST 5b', 'expected org reject');
    } catch (err) {
      assert.strictEqual(err.code, 'APPROVAL_NOT_AUTHORIZED');
    }
  }

  // TEST 6 — Approve twice → only one claim
  {
    resetApprovalStoreForTests();
    const store6 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store6.create('org-1', call, 'user-1');
    const c1 = await store6.claimForExecution(a.id, 'user-1');
    const c2 = await store6.claimForExecution(a.id, 'user-1');
    assert.ok(c1);
    assert.strictEqual(c2, undefined);
    pass('TEST 6 double approve/claim — only one execution claim');
  }

  // TEST 7 — Concurrent claim
  {
    resetApprovalStoreForTests();
    const store7 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store7.create('org-1', call, 'user-1');
    const [r1, r2] = await Promise.all([
      store7.claimForExecution(a.id, 'user-1'),
      store7.claimForExecution(a.id, 'user-1'),
    ]);
    const won = [r1, r2].filter(Boolean);
    assert.strictEqual(won.length, 1);
    pass('TEST 7 concurrent Approve & Run — single claim');
  }

  // TEST 8 — Expired approval
  {
    resetApprovalStoreForTests();
    const store8 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store8.create('org-1', call, 'user-1');
    const row = await store8.get(a.id);
    row.expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.ok(isApprovalExpired(row));
    const claimed = await store8.claimForExecution(a.id, 'user-1');
    assert.strictEqual(claimed, undefined);
    const after = await store8.get(a.id);
    assert.strictEqual(after.status, 'expired');
    pass('TEST 8 expired approval rejected');
  }

  // TEST 9 — Rejected cannot execute
  {
    resetApprovalStoreForTests();
    const store9 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store9.create('org-1', call, 'user-1');
    await store9.decide(a.id, 'rejected', 'user-1');
    const result = await executeApprovedAction(a.id);
    assert.strictEqual(result, undefined);
    pass('TEST 9 rejected approval cannot execute');
  }

  // TEST 10 — Completed cannot execute again (idempotent return)
  {
    resetApprovalStoreForTests();
    const store10 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store10.create('org-1', call, 'user-1');
    await store10.claimForExecution(a.id, 'user-1');
    // Simulate completed without connector
    await store10.completeExecution(
      a.id,
      { tool: 'jira', action: 'createIssue', ok: true, mocked: false, output: { key: 'KAN-FAKE' } },
      true
    );
    const again = await executeApprovedAction(a.id);
    assert.ok(again);
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.output.key, 'KAN-FAKE');
    // claim again fails
    assert.strictEqual(await store10.claimForExecution(a.id, 'user-1'), undefined);
    pass('TEST 10 completed approval does not re-execute connector');
  }

  // TEST 11 — Capability scope altered on pending then fingerprint updated — execute must still pass gate
  {
    resetApprovalStoreForTests();
    const store11 = useInMemoryApprovalStoreForTests();
    const call = jiraCall();
    const a = await store11.create('org-1', call, 'user-1');
    // Attacker tries to widen scope via updateInput — stamps are preserved by API,
    // but raw store updateInput allows full replace; simulate API-preserving update
    const next = {
      ...a.input,
      summary: 'Updated summary',
      _capabilityScope: a.input._capabilityScope,
      _intentFamily: a.input._intentFamily,
      _lockedCapability: a.input._lockedCapability,
    };
    const updated = await store11.updateInput(a.id, next);
    assert.ok(updated.payloadFingerprint !== a.payloadFingerprint);
    await store11.claimForExecution(a.id, 'user-1');
    // Integrity ok for fingerprint; capability gate still requires jira in scope
    try {
      assertApprovalExecutable(await store11.get(a.id));
      pass('TEST 11 rebound fingerprint with preserved scope remains valid');
    } catch (err) {
      fail('TEST 11', err);
    }
    // Direct scope wipe + matching fingerprint forge attempt
    const row = await store11.get(a.id);
    row.input = { ...row.input, _capabilityScope: ['slack.createWarRoom'] };
    row.payloadFingerprint = computeApprovalFingerprint(row.tool, row.action, row.input);
    try {
      assertApprovalExecutable(row);
      fail('TEST 11b', 'expected scope reject');
    } catch (err) {
      assert.ok(
        err.code === 'APPROVAL_SCOPE_CHANGED' ||
          err.code === 'CAPABILITY_NOT_ALLOWED' ||
          err.code === 'CAPABILITY_UNKNOWN'
      );
      pass('TEST 11b forged scope rejected by capability gate');
    }
  }

  console.log('SUMMARY approval integrity unit tests passed');
}

main().catch((e) => {
  console.error('FAIL suite', e);
  process.exit(1);
});
