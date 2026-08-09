import { Router } from 'express';
import { query, listConnections } from '@enterprise-ai-os/stores';
import { getApprovalStore } from '@enterprise-ai-os/agent-core';
import { ok, asyncHandler } from '../lib/errors';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;

    const [pending, conversations, connections, activity, org] = await Promise.all([
      getApprovalStore().list(orgId, 'pending', userId),
      query(
        `select id, title, updated_at from conversations
         where organization_id = $1 and user_id = $2
         order by updated_at desc limit 5`,
        [orgId, userId]
      ),
      listConnections(orgId, userId),
      query(
        `select id, event_type, tool, detail, created_at from audit_logs
         where organization_id = $1
         order by created_at desc limit 10`,
        [orgId]
      ).catch(() => ({ rows: [] as any[] })),
      query(`select name from organizations where id = $1`, [orgId]),
    ]);

    const demoMode = (process.env.SAAS_MODE ?? 'true') !== 'true';
    const slackLive = Boolean(process.env.SLACK_BOT_TOKEN?.trim());
    const notionLive = Boolean(process.env.NOTION_API_KEY?.trim());
    // Old demo UX: always show all 5 connectors (Slack + Notion live from .env; others mock)
    const connected = demoMode
      ? (['slack', 'jira', 'gmail', 'salesforce', 'notion'] as string[])
      : connections.filter((c) => c.status === 'active').map((c) => c.tool);

    // Guarantee classic shell numbers when tokens exist even if OAuth rows are empty
    const connectedCount = demoMode
      ? 5
      : Math.max(
          connected.length,
          [slackLive && 'slack', notionLive && 'notion'].filter(Boolean).length
        );

    const liveCount = demoMode
      ? [slackLive, notionLive].filter(Boolean).length || 2
      : [slackLive, notionLive].filter(Boolean).length || connected.length;

    ok(res, {
      workspaceName: org.rows[0]?.name ?? 'Workspace',
      metrics: {
        pendingApprovals: pending.length,
        recentConversations: conversations.rows.length,
        connectedIntegrations: connectedCount,
        liveAgents: liveCount,
      },
      pendingApprovals: pending.slice(0, 5),
      recentConversations: conversations.rows,
      integrations: connected.length ? connected : demoMode ? ['slack', 'jira', 'gmail', 'salesforce', 'notion'] : connected,
      activity: activity.rows,
      health: {
        api: true,
        database: Boolean(process.env.DATABASE_URL),
        chat: true,
        approvals: true,
      },
      liveTools: {
        slack: slackLive || demoMode,
        notion: notionLive || demoMode,
      },
      os: {
        pipeline: 'intent→plan→preflight→execute→verify→heal→memory→log',
        connectedShell: connectedCount,
        liveAgents: liveCount,
      },
    });
  })
);
