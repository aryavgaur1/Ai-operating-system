import { Router } from 'express';
import { getApprovalStore, executeApprovedAction } from '@enterprise-ai-os/agent-core';

export const approvalsRouter = Router();

approvalsRouter.get('/', async (req, res) => {
  const status = req.query.status as 'pending' | 'approved' | 'rejected' | 'expired' | undefined;
  const approvals = await getApprovalStore().list(req.user!.organizationId, status);
  res.json({ approvals });
});

approvalsRouter.post('/:id/decide', async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body ?? {};

  if (decision !== 'approved' && decision !== 'rejected') {
    return res.status(400).json({ error: 'decision must be "approved" or "rejected".' });
  }

  const updated = await getApprovalStore().decide(id, decision, req.user!.id);
  if (!updated) return res.status(404).json({ error: 'Approval not found.' });

  let executionResult;
  if (decision === 'approved') {
    executionResult = await executeApprovedAction(id);
  }

  res.json({ approval: updated, executionResult });
});
