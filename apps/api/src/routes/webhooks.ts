import { Router } from 'express';
import type { ToolName } from '@enterprise-ai-os/shared';
import { handleWebhookEvent } from '../ingestion/pipeline';
import { getDemoOrgId } from '../middleware/auth';

export const webhooksRouter = Router();

const VALID_TOOLS: ToolName[] = ['slack', 'jira', 'gmail', 'salesforce', 'notion'];

// Webhook endpoints are intentionally NOT behind the `authenticate`
// RBAC middleware — third-party platforms call these directly.
// A live deployment must verify each platform's own signing
// scheme here (Slack signing secret, Jira webhook secret, Google
// Pub/Sub JWT, Salesforce CDC auth, etc) before trusting payloads.
webhooksRouter.post('/:tool', async (req, res) => {
  const tool = req.params.tool as ToolName;
  if (!VALID_TOOLS.includes(tool)) {
    return res.status(404).json({ error: `Unknown tool: ${tool}` });
  }

  // TODO(live): verify the platform-specific webhook signature before proceeding.
  try {
    const result = await handleWebhookEvent(tool, getDemoOrgId(), req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[webhooks] failed to process ${tool} webhook:`, err);
    res.status(500).json({ ok: false, error: 'Failed to process webhook.' });
  }
});
