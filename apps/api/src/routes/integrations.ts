import { Router } from 'express';
import {
  allTools,
  getConnector,
  isLiveMode,
  isNotImplementedTool,
  isProductionLiveTool,
} from '@enterprise-ai-os/connectors';
import { getConnectionDetails, revokeConnection, storeConnection } from '@enterprise-ai-os/stores';
import { asyncHandler, ok, AppError } from '../lib/errors';

export const integrationsRouter = Router();

integrationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
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
      // Reject demo seed tokens — they are not real connections
      const isDemoToken = Boolean((meta as { demo?: boolean }).demo);
      const workspaceName =
        (typeof meta.teamName === 'string' && meta.teamName) ||
        (typeof meta.workspaceName === 'string' && meta.workspaceName) ||
        undefined;
      const workspaceId =
        (typeof meta.teamId === 'string' && meta.teamId) ||
        (typeof meta.workspaceId === 'string' && meta.workspaceId) ||
        undefined;
      const workspaceIcon = typeof meta.workspaceIcon === 'string' ? meta.workspaceIcon : undefined;

      const notImplemented = isNotImplementedTool(tool);
      const connectUrl =
        !notImplemented && tool === 'slack'
          ? `${apiBase}/oauth/slack/start?token=${encodeURIComponent(token)}`
          : !notImplemented && tool === 'notion'
            ? `${apiBase}/oauth/notion/start?token=${encodeURIComponent(token)}`
            : !notImplemented && tool === 'jira'
              ? `${apiBase}/oauth/jira/start?token=${encodeURIComponent(token)}`
              : null;

      const reallyConnected =
        !notImplemented &&
        !isDemoToken &&
        detail?.status === 'active' &&
        Boolean(detail?.hasAccessToken);

      const status = notImplemented
        ? 'not_implemented'
        : reallyConnected
          ? 'active'
          : 'not_connected';

      return {
        tool,
        status,
        implementation: notImplemented ? 'not_implemented' : isProductionLiveTool(tool) ? 'live' : 'unknown',
        mode: reallyConnected
          ? 'live'
          : notImplemented
            ? 'not_implemented'
            : isLiveMode(tool)
              ? 'live'
              : 'not_connected',
        availableActions: notImplemented ? [] : connector.listActions(),
        connectUrl,
        canConnect: !notImplemented && Boolean(connectUrl),
        workspaceName: reallyConnected ? workspaceName : undefined,
        workspaceId: reallyConnected ? workspaceId : undefined,
        workspaceIcon: reallyConnected ? workspaceIcon : undefined,
        connectedAt: reallyConnected ? detail?.connectedAt : undefined,
        lastUsedAt: reallyConnected ? detail?.lastUsedAt : undefined,
        lastSync: reallyConnected ? detail?.lastUsedAt || detail?.updatedAt : undefined,
        ...(tool === 'slack'
          ? {
              botToken: reallyConnected ? Boolean(detail?.hasAccessToken) : false,
              userToken: reallyConnected ? Boolean(detail?.hasUserToken) : false,
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

integrationsRouter.get(
  '/jira/fields',
  asyncHandler(async (req, res) => {
    const { withUserConnectorContext } = await import('../lib/withUserConnectors');
    const { getConnectorContext } = await import('@enterprise-ai-os/connectors');

    const fields = await withUserConnectorContext(
      { id: req.user!.id, organizationId: req.user!.organizationId },
      async () => {
        const ctx = getConnectorContext();
        const token = ctx.jiraToken?.trim();
        const cloudId = ctx.jiraCloudId?.trim();
        if (!token || !cloudId) {
          throw new AppError('Connect Jira under Integrations first.', 400);
        }
        const r = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/field`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!r.ok) {
          const body = await r.text();
          throw new AppError(`Jira field list failed (${r.status}): ${body.slice(0, 200)}`, 502);
        }
        const all = (await r.json()) as Array<{
          id: string;
          name: string;
          custom?: boolean;
          schema?: { type?: string; custom?: string };
        }>;
        const custom = all.filter((f) => f.custom || String(f.id).startsWith('customfield_'));
        const score = (name: string) => {
          const n = name.toLowerCase();
          return {
            sev: /\b(sev|severity)\b/.test(n),
            env: /\b(env|environment)\b/.test(n),
            deployRisk: /\b(deploy|deployment).*(risk)|risk.*(deploy|deployment)|\bdeploy risk\b/.test(n),
          };
        };
        const suggested = {
          JIRA_CUSTOM_SEV_FIELD: custom.find((f) => score(f.name).sev)?.id ?? null,
          JIRA_CUSTOM_ENV_FIELD: custom.find((f) => score(f.name).env)?.id ?? null,
          JIRA_CUSTOM_DEPLOY_RISK_FIELD: custom.find((f) => score(f.name).deployRisk)?.id ?? null,
        };
        return {
          suggested,
          customFields: custom.map((f) => ({ id: f.id, name: f.name, type: f.schema?.type })),
          total: all.length,
        };
      }
    );

    ok(res, fields);
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
