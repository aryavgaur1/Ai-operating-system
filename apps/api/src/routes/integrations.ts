import { Router } from 'express';
import { allTools, getConnector, isLiveMode } from '@enterprise-ai-os/connectors';
import { listConnections, revokeConnection } from '@enterprise-ai-os/stores';
import { asyncHandler, ok, AppError } from '../lib/errors';
import { webAppUrl } from '../lib/authTokens';

export const integrationsRouter = Router();

integrationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const demoMode = (process.env.SAAS_MODE ?? 'true') !== 'true';
    const connections = await listConnections(req.user!.organizationId, req.user!.id);
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    const token = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');

    const tools = allTools().map((tool) => {
      const connector = getConnector(tool);
      const connection = connections.find((c) => c.tool === tool && c.status === 'active');
      const envLive =
        (tool === 'slack' && Boolean(process.env.SLACK_BOT_TOKEN?.trim())) ||
        (tool === 'notion' && Boolean(process.env.NOTION_API_KEY?.trim()));
      const connectUrl =
        tool === 'slack'
          ? `${apiBase}/oauth/slack/start?token=${encodeURIComponent(token)}`
          : tool === 'notion'
            ? `${apiBase}/oauth/notion/start?token=${encodeURIComponent(token)}`
            : null;

      // Demo mode: all 5 look connected (old investor-demo shell)
      const status = demoMode
        ? 'active'
        : connection?.status ?? (envLive ? 'active' : 'not_connected');

      return {
        tool,
        status,
        mode: isLiveMode(tool) ? 'live' : 'mock',
        availableActions: connector.listActions(),
        connectUrl: demoMode ? null : connectUrl,
        canConnect: !demoMode && (tool === 'slack' || tool === 'notion'),
      };
    });
    res.json({ tools });
  })
);

integrationsRouter.post(
  '/:tool/disconnect',
  asyncHandler(async (req, res) => {
    const tool = req.params.tool as 'slack' | 'notion' | 'jira' | 'gmail' | 'salesforce';
    if (!['slack', 'notion', 'jira', 'gmail', 'salesforce'].includes(tool)) {
      throw new AppError('Unknown tool', 404);
    }
    await revokeConnection(req.user!.organizationId, tool, req.user!.id);
    ok(res, null, `${tool} disconnected`);
  })
);
