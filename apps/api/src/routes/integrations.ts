import { Router } from 'express';
import { allTools, getConnector, isLiveMode } from '@enterprise-ai-os/connectors';
import { getConnectionDetails, revokeConnection, storeConnection } from '@enterprise-ai-os/stores';
import { asyncHandler, ok, AppError } from '../lib/errors';

export const integrationsRouter = Router();

integrationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const demoMode = (process.env.SAAS_MODE ?? 'true') !== 'true';
    const details = await getConnectionDetails(req.user!.organizationId, req.user!.id);
    const apiBase = (
      process.env.API_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : null) ||
      `http://localhost:${process.env.PORT ?? 4000}`
    ).replace(/\/$/, '');
    const token = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');

    const tools = allTools().map((tool) => {
      const connector = getConnector(tool);
      const detail = details.find((c) => c.tool === tool && c.status === 'active');
      const meta = detail?.metadata ?? {};
      const workspaceName =
        (typeof meta.teamName === 'string' && meta.teamName) ||
        (typeof meta.workspaceName === 'string' && meta.workspaceName) ||
        undefined;
      const workspaceId =
        (typeof meta.teamId === 'string' && meta.teamId) ||
        (typeof meta.workspaceId === 'string' && meta.workspaceId) ||
        undefined;
      const workspaceIcon = typeof meta.workspaceIcon === 'string' ? meta.workspaceIcon : undefined;

      const connectUrl =
        tool === 'slack'
          ? `${apiBase}/oauth/slack/start?token=${encodeURIComponent(token)}`
          : tool === 'notion'
            ? `${apiBase}/oauth/notion/start?token=${encodeURIComponent(token)}`
            : tool === 'jira'
              ? `${apiBase}/oauth/jira/start?token=${encodeURIComponent(token)}`
              : null;

      // Demo/admin: all look connected; no Connect buttons (preserve admin UX)
      // SaaS: active ONLY if this user has a DB connection — never treat .env as theirs
      const status = demoMode ? 'active' : detail?.status === 'active' ? 'active' : 'not_connected';

      return {
        tool,
        status,
        mode: detail?.status === 'active' || isLiveMode(tool) || process.env[`${tool.toUpperCase()}_MODE`] === 'live' || process.env.CONNECTORS_MODE === 'live'
          ? 'live'
          : 'mock',
        availableActions: connector.listActions(),
        connectUrl: demoMode ? null : connectUrl,
        canConnect: !demoMode && (tool === 'slack' || tool === 'notion' || tool === 'jira'),
        workspaceName: demoMode
          ? tool === 'slack'
            ? 'Platform (admin .env)'
            : tool === 'notion'
              ? 'Platform (admin .env)'
              : tool === 'jira'
                ? 'Platform (admin .env)'
                : undefined
          : workspaceName,
        workspaceId: demoMode ? undefined : workspaceId,
        workspaceIcon: demoMode ? undefined : workspaceIcon,
        connectedAt: demoMode ? undefined : detail?.connectedAt,
        lastUsedAt: demoMode ? undefined : detail?.lastUsedAt,
        lastSync: demoMode ? undefined : detail?.lastUsedAt || detail?.updatedAt,
        ...(tool === 'slack'
          ? {
              botToken: demoMode
                ? Boolean(process.env.SLACK_BOT_TOKEN?.trim())
                : Boolean(detail?.hasAccessToken),
              userToken: demoMode
                ? Boolean(process.env.SLACK_USER_TOKEN?.trim())
                : Boolean(detail?.hasUserToken),
            }
          : {}),
      };
    });
    res.json({ tools });
  })
);

/**
 * Bypass Notion's Allow/timeout OAuth UI for local SaaS testing.
 * Paste an Internal Integration secret after sharing pages with it.
 */
integrationsRouter.post(
  '/notion/connect-token',
  asyncHandler(async (req, res) => {
    if ((process.env.ALLOW_NOTION_TOKEN_PASTE ?? '').toLowerCase() !== 'true') {
      throw new AppError('Notion token paste is disabled. Use Connect Notion (OAuth).', 403);
    }
    if ((process.env.SAAS_MODE ?? 'true') !== 'true') {
      throw new AppError('Token connect is only available when SAAS_MODE=true', 400);
    }
    const accessToken = String(req.body?.accessToken ?? req.body?.token ?? '').trim();
    if (!accessToken) {
      throw new AppError('Paste your Notion Internal Integration secret', 400);
    }

    const meRes = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (!meRes.ok) {
      const body = await meRes.text();
      console.error('[integrations/notion] token validate failed', meRes.status, body);
      throw new AppError(
        'Invalid Notion token. Create an Internal Integration → copy the secret → share pages with it.',
        400
      );
    }

    const me = (await meRes.json()) as {
      id?: string;
      name?: string | null;
      bot?: { workspace_name?: string; workspace_id?: string; owner?: Record<string, unknown> };
    };

    await storeConnection(req.user!.organizationId, 'notion', accessToken, {
      userId: req.user!.id,
      metadata: {
        workspaceName: me.bot?.workspace_name ?? me.name ?? 'Notion',
        workspaceId: me.bot?.workspace_id,
        botUserId: me.id,
        owner: me.bot?.owner ?? null,
        connectedAt: new Date().toISOString(),
        method: 'internal_token',
      },
    });

    ok(res, {
      connected: true,
      workspaceName: me.bot?.workspace_name ?? me.name ?? 'Notion',
    });
  })
);

integrationsRouter.post(
  '/:tool/disconnect',
  asyncHandler(async (req, res) => {
    const tool = req.params.tool as 'slack' | 'notion' | 'jira' | 'gmail' | 'salesforce';
    if (!['slack', 'notion', 'jira', 'gmail', 'salesforce'].includes(tool)) {
      throw new AppError('Unknown tool', 404);
    }
    // User-scoped only — never touches other users or admin .env
    await revokeConnection(req.user!.organizationId, tool, req.user!.id);
    ok(res, null, `${tool} disconnected`);
  })
);
