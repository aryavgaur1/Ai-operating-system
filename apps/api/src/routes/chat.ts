import { Router } from 'express';
import { runAgentTurn } from '@enterprise-ai-os/agent-core';
import {
  getAccessToken,
  getConnectionDetails,
  getSlackUserToken,
  touchConnectionLastUsed,
} from '@enterprise-ai-os/stores';
import {
  runWithConnectorContext,
  slackService,
  initializeNotionClient,
  clearNotionClient,
} from '@enterprise-ai-os/connectors';
import { getStores } from '../ingestion/pipeline';
import { persistChatTurn } from './conversations';
import { requireVerified } from '../middleware/auth';
import { AppError, asyncHandler } from '../lib/errors';

export const chatRouter = Router();

chatRouter.post(
  '/',
  requireVerified,
  asyncHandler(async (req, res) => {
    const { message, conversationId } = req.body ?? {};
    if (!message || typeof message !== 'string') {
      throw new AppError('Request body must include a string `message`.', 400);
    }

    const demoMode = (process.env.SAAS_MODE ?? 'true') !== 'true';
    const user = req.user!;
    const { vectorStore, graphStore } = getStores();

    let slackBotToken: string | undefined;
    let slackUserToken: string | undefined;
    let notionToken: string | undefined;
    let jiraToken: string | undefined;
    let jiraCloudId: string | undefined;
    let jiraSiteUrl: string | undefined;

    // Demo/admin: always use shared .env Slack/Notion (investor demo / pre-SaaS)
    if (demoMode) {
      try {
        slackService.clearClient();
        if (process.env.SLACK_BOT_TOKEN?.trim()) {
          slackBotToken = process.env.SLACK_BOT_TOKEN.trim();
          slackService.initializeClient(slackBotToken);
        }
        if (process.env.SLACK_USER_TOKEN?.trim()) {
          slackUserToken = process.env.SLACK_USER_TOKEN.trim();
          slackService.initializeUserClient(slackUserToken);
        }
      } catch {
        // ignore
      }
      try {
        clearNotionClient();
        if (process.env.NOTION_API_KEY?.trim()) {
          notionToken = process.env.NOTION_API_KEY.trim();
          initializeNotionClient(notionToken);
        }
      } catch {
        // ignore
      }
    } else {
      // SaaS customer: ONLY this user's DB OAuth tokens — never fall back to platform .env
      slackService.clearClient();
      clearNotionClient();
      try {
        slackBotToken = await getAccessToken(user.organizationId, 'slack', user.id);
        slackUserToken = await getSlackUserToken(user.organizationId, user.id);
        if (slackBotToken) {
          slackService.initializeClient(slackBotToken);
          void touchConnectionLastUsed(user.organizationId, 'slack', user.id);
        }
        if (slackUserToken) slackService.initializeUserClient(slackUserToken);
      } catch {
        // leave disconnected
      }

      try {
        notionToken = await getAccessToken(user.organizationId, 'notion', user.id);
        if (notionToken) {
          initializeNotionClient(notionToken);
          void touchConnectionLastUsed(user.organizationId, 'notion', user.id);
        }
      } catch {
        // leave disconnected
      }

      try {
        jiraToken = await getAccessToken(user.organizationId, 'jira', user.id);
        if (jiraToken) {
          const details = await getConnectionDetails(user.organizationId, user.id);
          const jira = details.find((d) => d.tool === 'jira' && d.status === 'active');
          const meta = jira?.metadata ?? {};
          jiraCloudId =
            (typeof meta.cloudId === 'string' && meta.cloudId) ||
            (typeof meta.workspaceId === 'string' && meta.workspaceId) ||
            undefined;
          jiraSiteUrl = typeof meta.siteUrl === 'string' ? meta.siteUrl : undefined;
          void touchConnectionLastUsed(user.organizationId, 'jira', user.id);
        }
      } catch {
        // leave disconnected
      }
    }

    const result = await runWithConnectorContext(
      {
        organizationId: user.organizationId,
        userId: user.id,
        slackBotToken,
        slackUserToken,
        notionToken,
        jiraToken,
        jiraCloudId,
        jiraSiteUrl,
        saasStrict: !demoMode,
      },
      () => runAgentTurn(message, user.organizationId, vectorStore, graphStore, user.id)
    );

    let savedConversationId: string | undefined;
    try {
      savedConversationId = await persistChatTurn({
        organizationId: user.organizationId,
        userId: user.id,
        conversationId,
        userMessage: message,
        assistantReply: result.reply,
        toolCalls: {
          plan: result.plan,
          executedCalls: result.executedCalls,
          pendingApprovalIds: result.pendingApprovalIds,
        },
      });
    } catch (err) {
      console.warn('[chat] persist failed:', err instanceof Error ? err.message : err);
    }

    res.json({ ...result, conversationId: savedConversationId });
  })
);
