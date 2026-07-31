import { Router } from 'express';
import { runAgentTurn } from '@enterprise-ai-os/agent-core';
import { getAccessToken } from '@enterprise-ai-os/stores';
import { runWithConnectorContext, slackService, initializeNotionClient } from '@enterprise-ai-os/connectors';
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

    // Demo mode: always use shared .env Slack/Notion (investor demo / pre-SaaS behavior)
    if (demoMode) {
      try {
        slackService.clearClient();
        if (process.env.SLACK_BOT_TOKEN?.trim()) slackService.initializeClient();
      } catch {
        // ignore
      }
      try {
        if (process.env.NOTION_API_KEY?.trim()) initializeNotionClient();
      } catch {
        // ignore
      }
    } else {
      try {
        const slackToken = await getAccessToken(user.organizationId, 'slack', user.id);
        if (slackToken) slackService.initializeClient(slackToken);
        else {
          slackService.clearClient();
          if (process.env.SLACK_BOT_TOKEN?.trim()) slackService.initializeClient();
        }
      } catch {
        try {
          slackService.clearClient();
          if (process.env.SLACK_BOT_TOKEN?.trim()) slackService.initializeClient();
        } catch {
          // leave disconnected
        }
      }

      try {
        const notionToken = await getAccessToken(user.organizationId, 'notion', user.id);
        if (notionToken) initializeNotionClient(notionToken);
        else if (process.env.NOTION_API_KEY?.trim()) initializeNotionClient();
      } catch {
        try {
          if (process.env.NOTION_API_KEY?.trim()) initializeNotionClient();
        } catch {
          // leave disconnected
        }
      }
    }

    const result = await runWithConnectorContext(
      { organizationId: user.organizationId, userId: user.id },
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
