import { Router } from 'express';
import { getApprovalStore, executeApprovedAction } from '@enterprise-ai-os/agent-core';
import {
  ApprovalIntegrityError,
  assertApprovalAuthorized,
  isApprovalExpired,
} from '@enterprise-ai-os/agent-core';
import { requireVerified } from '../middleware/auth';
import { asyncHandler } from '../lib/errors';
import { withUserConnectorContext } from '../lib/withUserConnectors';
import { query } from '@enterprise-ai-os/stores';

export const approvalsRouter = Router();

let schemaReady: Promise<void> | null = null;

/** Additive columns for execution + integrity — safe if already applied. */
function ensureApprovalExecutionSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      if ((process.env.SAAS_MODE ?? 'true') !== 'true' || !process.env.DATABASE_URL) return;
      try {
        await query(`alter table approvals add column if not exists execution_status text`);
        await query(`alter table approvals add column if not exists execution_result jsonb`);
        await query(
          `alter table approvals add column if not exists execution_verified boolean not null default false`
        );
        await query(`alter table approvals add column if not exists executed_at timestamptz`);
        await query(`alter table approvals add column if not exists payload_fingerprint text`);
        await query(`alter table approvals add column if not exists expires_at timestamptz`);
      } catch (err) {
        console.warn('[approvals] schema ensure skipped:', (err as Error).message);
      }
    })();
  }
  return schemaReady;
}

function integrityHttp(err: unknown): { status: number; code: string; error: string } {
  if (err instanceof ApprovalIntegrityError) {
    const status =
      err.code === 'APPROVAL_NOT_FOUND'
        ? 404
        : err.code === 'APPROVAL_NOT_AUTHORIZED'
          ? 403
          : err.code === 'APPROVAL_EXPIRED' ||
              err.code === 'APPROVAL_ALREADY_EXECUTED' ||
              err.code === 'APPROVAL_INVALID_STATE'
            ? 409
            : 409;
    return { status, code: err.code, error: err.message };
  }
  return { status: 500, code: 'APPROVAL_INVALID_STATE', error: err instanceof Error ? err.message : 'Approval error' };
}

approvalsRouter.get(
  '/',
  requireVerified,
  asyncHandler(async (req, res) => {
    await ensureApprovalExecutionSchema();
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | 'expired' | undefined;
    const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
    const store = getApprovalStore();
    const approvals = isAdmin
      ? await store.list(req.user!.organizationId, status)
      : await store.list(req.user!.organizationId, status, req.user!.id);
    res.json({ approvals });
  })
);

approvalsRouter.patch(
  '/:id/input',
  requireVerified,
  asyncHandler(async (req, res) => {
    await ensureApprovalExecutionSchema();
    const { id } = req.params;
    const body = req.body ?? {};
    const patch = body.input;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ error: 'input object is required.', code: 'APPROVAL_INVALID_STATE' });
    }

    const store = getApprovalStore();
    const existing = await store.get(id);
    if (!existing) return res.status(404).json({ error: 'Approval not found.', code: 'APPROVAL_NOT_FOUND' });

    try {
      assertApprovalAuthorized(existing, req.user!);
    } catch (err) {
      const mapped = integrityHttp(err);
      return res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }

    if (existing.status === 'expired' || isApprovalExpired(existing)) {
      await store.markExpired(id);
      return res.status(409).json({ error: 'Approval has expired.', code: 'APPROVAL_EXPIRED' });
    }
    if (existing.status !== 'pending') {
      return res.status(409).json({
        error: `Approval is already ${existing.status}.`,
        code: 'APPROVAL_INVALID_STATE',
      });
    }

    // Merge patch — preserve capability stamps (clients cannot widen scope)
    const nextInput = { ...(existing.input || {}), ...(patch as Record<string, unknown>) };
    if (existing.input?._intentFamily != null) nextInput._intentFamily = existing.input._intentFamily;
    if (existing.input?._capabilityScope != null) nextInput._capabilityScope = existing.input._capabilityScope;
    if (existing.input?._lockedCapability != null) nextInput._lockedCapability = existing.input._lockedCapability;

    if (typeof nextInput.project === 'string') {
      nextInput.project = String(nextInput.project).trim().toUpperCase();
      nextInput.projectKey = nextInput.project;
    }
    if (typeof nextInput.channel === 'string') {
      nextInput.channel = String(nextInput.channel).trim();
    }
    if (typeof nextInput.summary === 'string') nextInput.summary = String(nextInput.summary).trim();
    if (typeof nextInput.title === 'string') nextInput.title = String(nextInput.title).trim();
    if (typeof nextInput.text === 'string') nextInput.text = String(nextInput.text);

    const updated = await store.updateInput(id, nextInput);
    if (!updated) return res.status(409).json({ error: 'Could not update approval input.', code: 'APPROVAL_INVALID_STATE' });
    res.json({ approval: updated });
  })
);

approvalsRouter.post(
  '/:id/decide',
  requireVerified,
  asyncHandler(async (req, res) => {
    await ensureApprovalExecutionSchema();
    const { id } = req.params;
    const { decision, input: inputPatch } = req.body ?? {};

    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected".' });
    }

    const store = getApprovalStore();
    const existing = await store.get(id);
    if (!existing) return res.status(404).json({ error: 'Approval not found.', code: 'APPROVAL_NOT_FOUND' });

    try {
      assertApprovalAuthorized(existing, req.user!);
    } catch (err) {
      const mapped = integrityHttp(err);
      return res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }

    // Idempotency: already finished → return stored result (no re-execute)
    if (
      decision === 'approved' &&
      existing.status === 'approved' &&
      existing.executionResult &&
      (existing.executionStatus === 'completed' || existing.executionStatus === 'failed')
    ) {
      return res.json({
        approval: existing,
        executionResult: existing.executionResult,
        idempotent: true,
        code: 'APPROVAL_ALREADY_EXECUTED',
      });
    }

    if (decision === 'approved' && existing.status === 'approved' && existing.executionStatus === 'executing') {
      return res.status(409).json({
        error: 'Approval is already executing. Wait for the current run to finish.',
        code: 'APPROVAL_INVALID_STATE',
        approval: existing,
      });
    }

    if (existing.status === 'expired' || (existing.status === 'pending' && isApprovalExpired(existing))) {
      await store.markExpired(id);
      return res.status(409).json({ error: 'Approval has expired.', code: 'APPROVAL_EXPIRED' });
    }

    if (existing.status === 'rejected') {
      return res.status(409).json({
        error: 'Approval was rejected and cannot execute.',
        code: 'APPROVAL_INVALID_STATE',
      });
    }

    if (existing.status !== 'pending') {
      return res.status(409).json({
        error: `Approval is already ${existing.status}.`,
        code: 'APPROVAL_INVALID_STATE',
        approval: existing,
      });
    }

    // Optional last-second payload edit before claim (still pending — rebinds fingerprint)
    if (inputPatch && typeof inputPatch === 'object' && !Array.isArray(inputPatch)) {
      const nextInput = { ...(existing.input || {}), ...(inputPatch as Record<string, unknown>) };
      if (existing.input?._intentFamily != null) nextInput._intentFamily = existing.input._intentFamily;
      if (existing.input?._capabilityScope != null) nextInput._capabilityScope = existing.input._capabilityScope;
      if (existing.input?._lockedCapability != null) nextInput._lockedCapability = existing.input._lockedCapability;
      if (typeof nextInput.project === 'string') {
        nextInput.project = String(nextInput.project).trim().toUpperCase();
        nextInput.projectKey = nextInput.project;
      }
      const patched = await store.updateInput(id, nextInput);
      if (!patched) {
        return res.status(409).json({
          error: 'Could not update approval input before decide.',
          code: 'APPROVAL_INVALID_STATE',
        });
      }
    }

    if (decision === 'rejected') {
      const updated = await store.decide(id, 'rejected', req.user!.id);
      if (!updated) {
        return res.status(409).json({ error: 'Approval is no longer pending.', code: 'APPROVAL_INVALID_STATE' });
      }
      return res.json({ approval: updated });
    }

    // Atomic claim: pending → approved + executing (double-click / concurrent safe)
    const claimed = await store.claimForExecution(id, req.user!.id);
    if (!claimed) {
      const again = await store.get(id);
      if (again?.status === 'expired') {
        return res.status(409).json({ error: 'Approval has expired.', code: 'APPROVAL_EXPIRED' });
      }
      if (again?.executionResult) {
        return res.json({
          approval: again,
          executionResult: again.executionResult,
          idempotent: true,
          code: 'APPROVAL_ALREADY_EXECUTED',
        });
      }
      return res.status(409).json({
        error: 'Approval could not be claimed (already decided or executing).',
        code: 'APPROVAL_INVALID_STATE',
        approval: again,
      });
    }

    const executionResult = await withUserConnectorContext(
      { id: req.user!.id, organizationId: req.user!.organizationId },
      () => executeApprovedAction(id)
    );

    const finalApproval = (await store.get(id)) ?? claimed;
    res.json({ approval: finalApproval, executionResult });
  })
);
