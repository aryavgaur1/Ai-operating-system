import { Router } from 'express';
import type { ToolName } from '@enterprise-ai-os/shared';
import { isLiveMode, slackService } from '@enterprise-ai-os/connectors';
import { handleWebhookEvent } from '../ingestion/pipeline';
import { getDemoOrgId } from '../middleware/auth';
import { storeSlackEvent } from '@enterprise-ai-os/stores';

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

  // Slack Events API — verify signing secret, handle url_verification.
  if (tool === 'slack' && isLiveMode('slack')) {
    const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
    const signature = req.header('x-slack-signature') ?? undefined;
    const timestamp = req.header('x-slack-request-timestamp') ?? undefined;
    const rawBody = (req as any).rawBody ?? JSON.stringify(req.body ?? {});

    if (signingSecret) {
      const valid = slackService.verifySlackSignature(signingSecret, signature, timestamp, rawBody);
      if (!valid) {
        return res.status(401).json({ ok: false, error: 'Invalid Slack request signature' });
      }
    }

    const body = req.body ?? {};
    if (body.type === 'url_verification') {
      return res.status(200).json({ challenge: body.challenge });
    }

    if (body.type === 'event_callback') {
      const event = body.event ?? {};
      await storeSlackEvent({
        organizationId: getDemoOrgId(),
        eventId: body.event_id,
        eventType: String(event.type ?? 'unknown'),
        teamId: body.team_id,
        channelId: event.channel ?? event.item?.channel,
        userId: event.user,
        payload: body,
      }).catch(() => undefined);
    }
  }

  try {
    const result = await handleWebhookEvent(tool, getDemoOrgId(), req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[webhooks] failed to process ${tool} webhook:`, err);
    res.status(500).json({ ok: false, error: 'Failed to process webhook.' });
  }
});
