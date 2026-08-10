import { Router } from 'express';
import { getApprovalStore, executeApprovedAction } from '@enterprise-ai-os/agent-core';
import { requireVerified } from '../middleware/auth';
import { asyncHandler } from '../lib/errors';
import { withUserConnectorContext } from '../lib/withUserConnectors';
import { query } from '@enterprise-ai-os/stores';

export const approvalsRouter = Router();

let schemaReady: Promise<void> | null = null;

/** Additive columns for execution lifecycle — safe if already applied. */
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
      } catch (err) {
        console.warn('[approvals] schema ensure skipped:', (err as Error).message);
      }
    })();
  }
  return schemaReady;
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

approvalsRouter.post(
  '/:id/decide',
  requireVerified,
  asyncHandler(async (req, res) => {
    await ensureApprovalExecutionSchema();
    const { id } = req.params;
    const { decision } = req.body ?? {};

    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected".' });
    }

    const store = getApprovalStore();
    const existing = await store.get(id);
    if (!existing) return res.status(404).json({ error: 'Approval not found.' });
    if (existing.organizationId !== req.user!.organizationId && req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const isAdmin = req.user!.role === 'super_admin' || req.user!.role === 'admin';
    if (
      !isAdmin &&
      existing.requestedByUserId &&
      existing.requestedByUserId !== req.user!.id
    ) {
      return res.status(403).json({ error: 'Forbidden — only the requester (or an admin) can decide this approval.' });
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
      });
    }

    // In-flight: another click already claimed it
    if (decision === 'approved' && existing.status === 'approved' && existing.executionStatus === 'executing') {
      return res.status(409).json({
        error: 'Approval is already executing. Wait for the current run to finish.',
        approval: existing,
      });
    }

    if (existing.status !== 'pending') {
      return res.status(409).json({
        error: `Approval is already ${existing.status}.`,
        approval: existing,
      });
    }

    if (decision === 'rejected') {
      const updated = await store.decide(id, 'rejected', req.user!.id);
      if (!updated) {
        return res.status(409).json({ error: 'Approval is no longer pending.' });
      }
      return res.json({ approval: updated });
    }

    // Atomic claim: pending → approved + executing (double-click safe)
    const claimed = await store.claimForExecution(id, req.user!.id);
    if (!claimed) {
      const again = await store.get(id);
      if (again?.executionResult) {
        return res.json({ approval: again, executionResult: again.executionResult, idempotent: true });
      }
      return res.status(409).json({
        error: 'Approval could not be claimed (already decided or executing).',
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
