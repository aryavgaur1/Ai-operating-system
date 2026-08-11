import { Router, type Request, type Response, type NextFunction } from 'express';
import { isLiveMode, slackService, SlackServiceError, runWithConnectorContext, replyApprovalOutcome } from '@enterprise-ai-os/connectors';
import { runAgentTurn, getApprovalStore, executeApprovedAction } from '@enterprise-ai-os/agent-core';
import {
  getSlackInstallation,
  upsertSlackInstallation,
  storeSlackEvent,
  listSlackEvents,
  logSlackAction,
} from '@enterprise-ai-os/stores';
import { handleWebhookEvent, getStores } from '../ingestion/pipeline';
import { getDemoOrgId } from '../middleware/auth';
import { asyncHandler, ok, fail, AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { withUserConnectorContext } from '../lib/withUserConnectors';

export const slackRouter = Router();
/** Unauthenticated Events API endpoint (mounted before RBAC). */
export const slackEventsRouter = Router();
/** Slash commands + interactive components (Approve & Run buttons). */
export const slackCommandsRouter = Router();
export const slackInteractionsRouter = Router();

type AuthedRequest = Request & { rawBody?: Buffer | string };

function orgId(req: Request): string {
  return req.user?.organizationId ?? getDemoOrgId();
}

function userId(req: Request): string | undefined {
  return req.user?.id;
}

async function timedAction<T>(
  req: Request,
  action: string,
  payload: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  let workspace: string | undefined;
  try {
    if (isLiveMode('slack')) {
      const info = await slackService.getWorkspaceInfo().catch(() => null);
      workspace = info?.teamName;
    }
  } catch {
    // ignore
  }

  try {
    const result = await fn();
    await logSlackAction({
      organizationId: orgId(req),
      userId: userId(req),
      workspace,
      action,
      payload,
      status: 'ok',
      executionTimeMs: Date.now() - started,
    });
    return result;
  } catch (err: any) {
    const message = err instanceof SlackServiceError ? err.message : err?.message ?? String(err);
    await logSlackAction({
      organizationId: orgId(req),
      userId: userId(req),
      workspace,
      action,
      payload,
      status: 'error',
      error: message,
      executionTimeMs: Date.now() - started,
    });
    if (err instanceof SlackServiceError) {
      throw new AppError(err.message, err.statusCode);
    }
    throw err;
  }
}

function ensureLive(): void {
  if (!isLiveMode('slack')) {
    throw new AppError('Slack is in mock mode. Set SLACK_MODE=live in .env.', 400);
  }
  slackService.initializeClient();
}

// ---------- Status ----------
slackRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const mode = isLiveMode('slack') ? 'live' : 'mock';
    const installation = await getSlackInstallation(orgId(req));

    if (mode !== 'live') {
      return ok(res, {
        mode,
        status: 'active',
        connected: true,
        botInstalled: false,
        workspace: null,
        lastSync: installation?.last_synced_at ?? null,
        availableActions: ['postMessage', 'postMessageExternalChannel'],
      });
    }

    try {
      const info = await timedAction(req, 'status.authTest', {}, () => slackService.authTest());
      await upsertSlackInstallation({
        organizationId: orgId(req),
        teamId: info.teamId,
        teamName: info.teamName,
        botUserId: info.botUserId,
        appId: process.env.SLACK_APP_ID,
        status: 'active',
        metadata: { url: info.url },
      });

      return ok(res, {
        mode: 'live',
        status: 'connected',
        connected: true,
        botInstalled: true,
        workspace: info.teamName ?? null,
        teamId: info.teamId,
        botUserId: info.botUserId,
        lastSync: new Date().toISOString(),
        availableActions: [
          'postMessage',
          'postMessageExternalChannel',
          'listChannels',
          'listUsers',
          'getChannelHistory',
          'getThread',
          'searchHistory',
          'summarizeChannel',
          'uploadFile',
          'addReaction',
          'createChannel',
          'inviteUsers',
        ],
      });
    } catch (err: any) {
      const message = err instanceof AppError ? err.message : err?.message ?? String(err);
      return ok(
        res,
        {
          mode: 'live',
          status: 'error',
          connected: false,
          botInstalled: false,
          workspace: installation?.team_name ?? null,
          lastSync: installation?.last_synced_at ?? null,
          error: message,
          availableActions: [],
        },
        'Slack live mode configured but connection failed'
      );
    }
  })
);

// ---------- Post message ----------
slackRouter.post(
  '/post',
  asyncHandler(async (req, res) => {
    ensureLive();
    const { channel, text, threadTs } = req.body ?? {};
    if (!channel || !text) throw new AppError('channel and text are required', 400);

    const result = await timedAction(req, 'postMessage', { channel, text, threadTs }, () =>
      slackService.postMessage({ channel: String(channel), text: String(text), threadTs })
    );
    return ok(res, result, `Successfully posted to ${String(channel).startsWith('@') ? channel : `#${String(channel).replace(/^#/, '')}`}`);
  })
);

// ---------- Channels ----------
slackRouter.get(
  '/channels',
  asyncHandler(async (req, res) => {
    ensureLive();
    const limit = Number(req.query.limit ?? 200);
    const channels = await timedAction(req, 'listChannels', { limit }, () => slackService.listChannels(limit));
    return ok(res, { channels });
  })
);

slackRouter.post(
  '/channels',
  asyncHandler(async (req, res) => {
    ensureLive();
    const { name, isPrivate } = req.body ?? {};
    if (!name) throw new AppError('name is required', 400);
    const result = await timedAction(req, 'createChannel', { name, isPrivate }, () =>
      slackService.createChannel({ name: String(name), isPrivate: Boolean(isPrivate) })
    );
    return ok(res, result, 'Channel created');
  })
);

// ---------- History / threads ----------
slackRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    ensureLive();
    const channel = String(req.query.channel ?? '');
    if (!channel) throw new AppError('channel query param is required', 400);
    const result = await timedAction(
      req,
      'getChannelHistory',
      { channel, limit: req.query.limit },
      () =>
        slackService.getChannelHistory({
          channel,
          limit: Number(req.query.limit ?? 50),
          oldest: req.query.oldest ? String(req.query.oldest) : undefined,
          latest: req.query.latest ? String(req.query.latest) : undefined,
          cursor: req.query.cursor ? String(req.query.cursor) : undefined,
        })
    );
    return ok(res, result);
  })
);

slackRouter.get(
  '/thread',
  asyncHandler(async (req, res) => {
    ensureLive();
    const channel = String(req.query.channel ?? '');
    const threadTs = String(req.query.threadTs ?? req.query.ts ?? '');
    if (!channel || !threadTs) throw new AppError('channel and threadTs are required', 400);
    const result = await timedAction(req, 'getThread', { channel, threadTs }, () =>
      slackService.getThread({ channel, threadTs, limit: Number(req.query.limit ?? 50) })
    );
    return ok(res, result);
  })
);

// ---------- Users ----------
slackRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    ensureLive();
    const users = await timedAction(req, 'listUsers', { limit: req.query.limit }, () =>
      slackService.listUsers(Number(req.query.limit ?? 200))
    );
    return ok(res, { users });
  })
);

slackRouter.post(
  '/invite',
  asyncHandler(async (req, res) => {
    ensureLive();
    const { channel, users } = req.body ?? {};
    if (!channel || !users) throw new AppError('channel and users are required', 400);
    const result = await timedAction(req, 'inviteUsers', { channel, users }, () =>
      slackService.inviteUsers({ channel: String(channel), users })
    );
    return ok(res, result, 'Users invited');
  })
);

// ---------- Search ----------
slackRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    ensureLive();
    const q = String(req.query.q ?? req.query.query ?? '');
    if (!q) throw new AppError('q (query) is required', 400);
    const result = await timedAction(req, 'searchHistory', { query: q }, () =>
      slackService.searchHistory(q, Number(req.query.count ?? 20))
    );
    return ok(res, result);
  })
);

// ---------- Upload / react ----------
slackRouter.post(
  '/upload',
  asyncHandler(async (req, res) => {
    ensureLive();
    const { channel, channels, content, filename, title, initialComment } = req.body ?? {};
    const target = channels ?? channel;
    if (!target) throw new AppError('channel (or channels) is required', 400);
    if (content == null && !req.body?.file) throw new AppError('content is required for text uploads', 400);

    const result = await timedAction(req, 'uploadFile', { channel: target, filename, title }, () =>
      slackService.uploadFile({
        channels: target,
        content: content != null ? String(content) : undefined,
        filename,
        title,
        initialComment,
      })
    );
    return ok(res, result, 'File uploaded');
  })
);

slackRouter.post(
  '/react',
  asyncHandler(async (req, res) => {
    ensureLive();
    const { channel, timestamp, ts, name, reaction } = req.body ?? {};
    const stamp = timestamp ?? ts;
    const emoji = name ?? reaction;
    if (!channel || !stamp || !emoji) throw new AppError('channel, timestamp, and name are required', 400);
    const result = await timedAction(req, 'addReaction', { channel, timestamp: stamp, name: emoji }, () =>
      slackService.addReaction({ channel: String(channel), timestamp: String(stamp), name: String(emoji) })
    );
    return ok(res, result, 'Reaction added');
  })
);

// ---------- Stored events (read) ----------
slackRouter.get(
  '/events',
  asyncHandler(async (_req, res) => {
    const events = await listSlackEvents(Number(_req.query.limit ?? 50));
    return ok(res, { events });
  })
);

// ---------- Events API (url_verification + event_callback) ----------
slackEventsRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
    const signature = req.header('x-slack-signature') ?? undefined;
    const timestamp = req.header('x-slack-request-timestamp') ?? undefined;
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});

    if (signingSecret) {
      const valid = slackService.verifySlackSignature(signingSecret, signature, timestamp, rawBody);
      if (!valid) {
        logger.warn('slack.events.invalid_signature', { timestamp });
        return fail(res, 'Invalid Slack request signature', 401, 'invalid_signature');
      }
    } else {
      logger.warn('slack.events.missing_signing_secret', {});
    }

    const body = req.body ?? {};

    // URL verification challenge
    if (body.type === 'url_verification') {
      return res.status(200).json({ challenge: body.challenge });
    }

    if (body.type === 'event_callback') {
      const event = body.event ?? {};
      const eventType = String(event.type ?? 'unknown');
      const supported = eventType === 'message' || eventType === 'app_mention' || eventType === 'reaction_added';

      // Ignore message subtypes like message_changed / bot echoes when they lack text
      const isBotMessage = Boolean(event.bot_id) && eventType === 'message';
      const isMessageSubtype = eventType === 'message' && event.subtype && event.subtype !== 'file_share';

      await storeSlackEvent({
        organizationId: getDemoOrgId(),
        eventId: body.event_id,
        eventType,
        teamId: body.team_id,
        channelId: event.channel ?? event.item?.channel,
        userId: event.user,
        payload: body,
      });

      if (supported && !isBotMessage && !isMessageSubtype) {
        try {
          await handleWebhookEvent('slack', getDemoOrgId(), body);
        } catch (err) {
          logger.error('slack.events.ingest_failed', {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Slack Agent Mode: @nexora mentions → reason → plan → execute → reply in-thread
      if (eventType === 'app_mention' && event.text && event.channel && !event.bot_id) {
        const mentionText = String(event.text).replace(/<@[A-Z0-9]+>/g, '').trim();
        if (mentionText) {
          void (async () => {
            const started = Date.now();
            try {
              if (isLiveMode('slack') && process.env.SLACK_BOT_TOKEN?.trim()) {
                slackService.initializeClient();
              }
              const { vectorStore, graphStore } = getStores();
              const orgId = getDemoOrgId();
              const result = await runWithConnectorContext({ organizationId: orgId }, () =>
                runAgentTurn(mentionText, orgId, vectorStore, graphStore)
              );
              await slackService.postMessage({
                channel: String(event.channel),
                text: result.reply.slice(0, 3500) || 'Done.',
                threadTs: event.thread_ts || event.ts,
              });
              await logSlackAction({
                organizationId: orgId,
                action: 'app_mention_agent',
                payload: {
                  text: mentionText,
                  executed: result.executedCalls.map((c) => ({ action: c.action, ok: c.ok })),
                },
                status: 'ok',
                executionTimeMs: Date.now() - started,
              });
            } catch (err) {
              logger.error('slack.app_mention_agent_failed', {
                message: err instanceof Error ? err.message : String(err),
              });
              try {
                await slackService.postMessage({
                  channel: String(event.channel),
                  text: `I hit an error running that: ${err instanceof Error ? err.message : String(err)}`,
                  threadTs: event.thread_ts || event.ts,
                });
              } catch {
                // ignore secondary failure
              }
            }
          })();
        }
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  })
);

function verifySlackRequest(req: AuthedRequest): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    logger.warn('slack.signature.missing_signing_secret', {});
    return true; // allow in misconfigured demo; prefer secret in prod
  }
  const signature = req.header('x-slack-signature') ?? undefined;
  const timestamp = req.header('x-slack-request-timestamp') ?? undefined;
  const rawBody = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  return slackService.verifySlackSignature(signingSecret, signature, timestamp, String(rawBody));
}

/** Slash command: /nexora <natural language> */
slackCommandsRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    if (!verifySlackRequest(req)) {
      return fail(res, 'Invalid Slack request signature', 401, 'invalid_signature');
    }

    const text = String(req.body?.text ?? '').trim();
    const channelId = String(req.body?.channel_id ?? '');
    const userId = String(req.body?.user_id ?? '');
    const responseUrl = String(req.body?.response_url ?? '');

    // Acknowledge immediately (Slack requires < 3s)
    res.status(200).json({
      response_type: 'ephemeral',
      text: text
        ? `Working on: ${text.slice(0, 200)}…`
        : 'Usage: `/nexora create war room for Atlas` or `/nexora what blocked engineering?`',
    });

    if (!text) return;

    void (async () => {
      const started = Date.now();
      const orgId = getDemoOrgId();
      try {
        if (isLiveMode('slack') && process.env.SLACK_BOT_TOKEN?.trim()) {
          slackService.initializeClient();
        }
        const { vectorStore, graphStore } = getStores();
        const result = await runWithConnectorContext({ organizationId: orgId }, () =>
          runAgentTurn(text, orgId, vectorStore, graphStore)
        );
        const reply = (result.reply || 'Done.').slice(0, 3500);
        if (responseUrl) {
          await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response_type: 'in_channel', text: reply }),
          }).catch(() => undefined);
        } else if (channelId) {
          await slackService.postMessage({ channel: channelId, text: reply });
        }
        await logSlackAction({
          organizationId: orgId,
          action: 'slash_nexora',
          payload: { text, userId, executed: result.executedCalls.map((c) => ({ action: c.action, ok: c.ok })) },
          status: 'ok',
          executionTimeMs: Date.now() - started,
        });
      } catch (err) {
        logger.error('slack.slash_nexora_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        if (responseUrl) {
          await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'ephemeral',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            }),
          }).catch(() => undefined);
        }
      }
    })();
  })
);

/** Interactive components: Approve & Run / Reject buttons */
slackInteractionsRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    if (!verifySlackRequest(req)) {
      return fail(res, 'Invalid Slack request signature', 401, 'invalid_signature');
    }

    let payload: any = req.body?.payload ?? req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        return fail(res, 'Invalid interaction payload', 400);
      }
    }

    const action = payload?.actions?.[0];
    const actionId = String(action?.action_id ?? '');
    const approvalId = String(action?.value ?? '').trim();
    const channelId = String(payload?.channel?.id ?? payload?.container?.channel_id ?? '');
    const messageTs = String(payload?.message?.ts ?? payload?.container?.message_ts ?? '');
    const slackUser = String(payload?.user?.id ?? 'slack-user');

    // Ack immediately (empty 200 — follow-up via chat.postMessage)
    res.status(200).send();

    if (!approvalId || (actionId !== 'nexora_approve_run' && actionId !== 'nexora_reject')) {
      return;
    }

    void (async () => {
      const store = getApprovalStore();
      const orgId = getDemoOrgId();
      try {
        if (actionId === 'nexora_reject') {
          const updated = await store.decide(approvalId, 'rejected', `slack:${slackUser}`);
          await replyApprovalOutcome({
            channel: channelId,
            threadTs: messageTs,
            text: updated
              ? `Rejected \`${updated.tool}.${updated.action}\` (\`${approvalId}\`) by <@${slackUser}>.`
              : `Could not reject \`${approvalId}\` — already decided or missing.`,
          });
          return;
        }

        const existing = await store.get(approvalId);
        if (!existing) {
          await replyApprovalOutcome({
            channel: channelId,
            threadTs: messageTs,
            text: `Approval \`${approvalId}\` not found.`,
          });
          return;
        }

        if (
          existing.status === 'approved' &&
          existing.executionResult &&
          (existing.executionStatus === 'completed' || existing.executionStatus === 'failed')
        ) {
          const okRun = existing.executionResult.ok;
          await replyApprovalOutcome({
            channel: channelId,
            threadTs: messageTs,
            text: `Already ${okRun ? 'completed' : 'failed'}: \`${existing.tool}.${existing.action}\` (idempotent).`,
          });
          return;
        }

        const claimed = await store.claimForExecution(approvalId, `slack:${slackUser}`);
        if (!claimed) {
          await replyApprovalOutcome({
            channel: channelId,
            threadTs: messageTs,
            text: `Could not claim \`${approvalId}\` — already decided or executing.`,
          });
          return;
        }

        const executionResult = await withUserConnectorContext(
          { id: `slack:${slackUser}`, organizationId: existing.organizationId || orgId },
          () => executeApprovedAction(approvalId)
        );

        const final = (await store.get(approvalId)) ?? claimed;
        const okRun = Boolean(executionResult?.ok && !executionResult?.mocked);
        await replyApprovalOutcome({
          channel: channelId,
          threadTs: messageTs,
          text: okRun
            ? `Approved & ran \`${final.tool}.${final.action}\` by <@${slackUser}>${
                final.executionVerified ? ' · verified externally' : ''
              }.`
            : `Approve & run failed for \`${final.tool}.${final.action}\`: ${
                executionResult?.error ?? 'unknown error'
              }`,
        });
      } catch (err) {
        logger.error('slack.interaction_approve_failed', {
          message: err instanceof Error ? err.message : String(err),
          approvalId,
        });
        await replyApprovalOutcome({
          channel: channelId,
          threadTs: messageTs,
          text: `Approve & run error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  })
);

/** Express error passthrough helper for this router if needed by tests. */
export function slackErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof SlackServiceError) {
    return fail(res, err.message, err.statusCode, err.code);
  }
  return next(err);
}
