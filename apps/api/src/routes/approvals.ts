import { Router } from 'express';
import { getApprovalStore, executeApprovedAction } from '@enterprise-ai-os/agent-core';
import { requireVerified } from '../middleware/auth';
import { asyncHandler } from '../lib/errors';
import { withUserConnectorContext } from '../lib/withUserConnectors';

export const approvalsRouter = Router();

approvalsRouter.get(
  '/',
  requireVerified,
  asyncHandler(async (req, res) => {
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

    const updated = await store.decide(id, decision, req.user!.id);
    let executionResult;
    if (decision === 'approved') {
      executionResult = await withUserConnectorContext(
        { id: req.user!.id, organizationId: req.user!.organizationId },
        () => executeApprovedAction(id)
      );
    }

    res.json({ approval: updated, executionResult });
  })
);
