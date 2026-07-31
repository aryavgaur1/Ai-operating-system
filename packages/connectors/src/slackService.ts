import crypto from 'crypto';
import { WebClient, ErrorCode, type WebAPICallResult } from '@slack/web-api';

// ============================================================
// slack_service — thin wrapper around @slack/web-api's WebClient.
// Auth: SLACK_BOT_TOKEN (Bot User OAuth Token) from .env, same
// pattern Notion uses with NOTION_API_KEY.
// ============================================================

export class SlackServiceError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code = 'slack_error', statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

let _client: WebClient | null = null;
let _cachedAuth: {
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  userId?: string;
} | null = null;

export function getSlackBotToken(): string {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new SlackServiceError('SLACK_BOT_TOKEN is not set in .env', 'invalid_token', 401);
  }
  return token;
}

/** Initialize (or return) the singleton Slack WebClient. */
export function initializeClient(token?: string): WebClient {
  if (_client && !token) return _client;
  const auth = token ?? getSlackBotToken();
  _client = new WebClient(auth);
  _cachedAuth = null;
  return _client;
}

export function getClient(): WebClient {
  return initializeClient();
}

function mapSlackError(err: any): SlackServiceError {
  const data = err?.data ?? {};
  const apiError = String(data.error ?? err?.code ?? err?.message ?? 'unknown_error');

  if (err?.code === ErrorCode.PlatformError) {
    switch (apiError) {
      case 'invalid_auth':
      case 'not_authed':
      case 'token_revoked':
      case 'token_expired':
      case 'account_inactive':
        return new SlackServiceError('Invalid or revoked Slack token', 'invalid_token', 401);
      case 'missing_scope':
        return new SlackServiceError(
          `Missing Slack permissions: ${data.needed ?? data.provided ?? 'unknown scope'}`,
          'missing_permissions',
          403
        );
      case 'channel_not_found':
      case 'not_in_channel':
        return new SlackServiceError('Slack channel not found (or bot is not a member)', 'channel_not_found', 404);
      case 'user_not_found':
        return new SlackServiceError('Slack user not found', 'user_not_found', 404);
      case 'ratelimited':
      case 'rate_limited':
        return new SlackServiceError('Slack rate limit exceeded — retry later', 'rate_limited', 429);
      case 'is_archived':
        return new SlackServiceError('Slack channel is archived', 'channel_archived', 400);
      case 'name_taken':
        return new SlackServiceError('Channel name already taken', 'name_taken', 409);
      default:
        return new SlackServiceError(`Slack API error: ${apiError}`, apiError, 400);
    }
  }

  if (err?.code === ErrorCode.RequestError || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(String(err?.message))) {
    return new SlackServiceError('Slack is unreachable (downtime or network error)', 'slack_downtime', 503);
  }

  if (err instanceof SlackServiceError) return err;
  return new SlackServiceError(err?.message ?? String(err), 'slack_error', 500);
}

async function callSlack<T extends WebAPICallResult>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    if ((result as any).ok === false) {
      throw new SlackServiceError(`Slack API error: ${(result as any).error ?? 'unknown'}`, String((result as any).error ?? 'slack_error'));
    }
    return result;
  } catch (err) {
    throw mapSlackError(err);
  }
}

/** Verify Slack Events API / slash-command request signature. */
export function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: string | Buffer
): boolean {
  if (!signingSecret || !signature || !timestamp) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject requests older than 5 minutes (replay protection).
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 60 * 5) return false;

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const base = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(base, 'utf8').digest('hex');
  const computed = `v0=${hmac}`;

  try {
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function authTest() {
  const client = getClient();
  const res = await callSlack(() => client.auth.test());
  _cachedAuth = {
    teamId: res.team_id as string | undefined,
    teamName: res.team as string | undefined,
    botUserId: (res.bot_id as string | undefined) ?? (res.user_id as string | undefined),
    userId: res.user_id as string | undefined,
  };
  return {
    ok: true,
    teamId: _cachedAuth.teamId,
    teamName: _cachedAuth.teamName,
    botUserId: _cachedAuth.botUserId,
    userId: _cachedAuth.userId,
    url: res.url,
  };
}

export async function getWorkspaceInfo() {
  if (_cachedAuth?.teamName) return _cachedAuth;
  const info = await authTest();
  return {
    teamId: info.teamId,
    teamName: info.teamName,
    botUserId: info.botUserId,
    userId: info.userId,
  };
}

/** Resolve #name / name / C… id / @user to a conversation id. */
export async function resolveChannelId(channel: string): Promise<string> {
  const raw = String(channel ?? '').trim();
  if (!raw) throw new SlackServiceError('channel is required', 'channel_required', 400);
  if (/^[CGD][A-Z0-9]+$/i.test(raw)) return raw;

  // Optional override for workspaces where the bot lacks channels:read.
  const defaultId = process.env.SLACK_DEFAULT_CHANNEL_ID?.trim();
  const name = raw.replace(/^#/, '').toLowerCase();
  if (defaultId && (name === 'general' || name === 'default')) {
    return defaultId;
  }

  // @user or bare username → open a DM (requires im:write).
  if (raw.startsWith('@') || /^U[A-Z0-9]+$/i.test(raw)) {
    const client = getClient();
    let userId = /^U[A-Z0-9]+$/i.test(raw) ? raw : undefined;
    const userRef = raw.replace(/^@/, '');
    if (!userId) {
      const users = await listUsers(200);
      const match = users.find(
        (u) =>
          u.name?.toLowerCase() === userRef.toLowerCase() ||
          u.real_name?.toLowerCase() === userRef.toLowerCase() ||
          u.display_name?.toLowerCase() === userRef.toLowerCase()
      );
      userId = match?.id;
    }
    if (!userId) throw new SlackServiceError(`Slack user not found: ${raw}`, 'user_not_found', 404);
    const opened = await callSlack(() => client.conversations.open({ users: userId! }));
    const id = (opened as any).channel?.id;
    if (!id) throw new SlackServiceError('Failed to open DM channel', 'dm_open_failed', 500);
    return id;
  }

  try {
    const channels = await listChannels();
    const match = channels.find((c) => c.name?.toLowerCase() === name || c.name_normalized?.toLowerCase() === name);
    if (match?.id) return match.id;
  } catch (err) {
    // Bot tokens without channels:read can still post by channel name if they're a member.
    if (err instanceof SlackServiceError && err.code === 'missing_permissions') {
      return name;
    }
    throw err;
  }

  // chat.postMessage accepts a public channel name when the bot is a member.
  return name;
}

export async function postMessage(input: { channel: string; text: string; threadTs?: string }) {
  const client = getClient();
  const channel = await resolveChannelId(input.channel);

  const attempt = async (target: string) =>
    callSlack(() =>
      client.chat.postMessage({
        channel: target,
        text: String(input.text ?? ''),
        thread_ts: input.threadTs,
      })
    );

  try {
    const res = await attempt(channel);
    return {
      ok: true,
      channel: res.channel,
      ts: res.ts,
      message: res.message,
    };
  } catch (err) {
    if (!(err instanceof SlackServiceError) || (err.code !== 'channel_not_found' && err.code !== 'not_in_channel')) {
      throw err;
    }

    // Try joining public channels when the bot isn't a member yet.
    try {
      const joined = await callSlack(() => client.conversations.join({ channel }));
      const joinedId = (joined as any).channel?.id ?? channel;
      const res = await attempt(joinedId);
      return {
        ok: true,
        channel: res.channel,
        ts: res.ts,
        message: res.message,
      };
    } catch {
      throw new SlackServiceError(
        `Slack channel not found or bot is not a member of #${String(input.channel).replace(/^#/, '')}. Invite the bot to the channel and ensure the app has chat:write + channels:join (and channels:read to list channels).`,
        'channel_not_found',
        404
      );
    }
  }
}

/** Alias used by high-consequence external-channel posts. */
export async function postExternalMessage(input: { channel: string; text: string; threadTs?: string }) {
  return postMessage(input);
}

export async function listChannels(limit = 200) {
  const client = getClient();
  const channels: Array<{
    id: string;
    name?: string;
    name_normalized?: string;
    is_private?: boolean;
    is_member?: boolean;
    num_members?: number;
    topic?: string;
    purpose?: string;
  }> = [];

  const push = (ch: any) => {
    if (!ch?.id) return;
    channels.push({
      id: ch.id,
      name: ch.name,
      name_normalized: ch.name_normalized,
      is_private: ch.is_private,
      is_member: ch.is_member ?? true,
      num_members: ch.num_members,
      topic: ch.topic?.value,
      purpose: ch.purpose?.value,
    });
  };

  try {
    let cursor: string | undefined;
    do {
      const res = await callSlack(() =>
        client.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: Math.min(limit, 200),
          cursor,
        })
      );
      for (const ch of res.channels ?? []) push(ch);
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor && channels.length < limit);
    return channels;
  } catch (err) {
    // Fallback: channels the bot is already in (users.conversations).
    if (!(err instanceof SlackServiceError) || err.code !== 'missing_permissions') throw err;

    let cursor: string | undefined;
    do {
      const res = await callSlack(() =>
        client.users.conversations({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: Math.min(limit, 200),
          cursor,
        })
      );
      for (const ch of res.channels ?? []) push(ch);
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor && channels.length < limit);

    return channels;
  }
}

export async function listUsers(limit = 200) {
  const client = getClient();
  const users: Array<{
    id: string;
    name?: string;
    real_name?: string;
    display_name?: string;
    is_bot?: boolean;
    deleted?: boolean;
  }> = [];

  let cursor: string | undefined;
  do {
    const res = await callSlack(() => client.users.list({ limit: Math.min(limit, 200), cursor }));
    for (const u of res.members ?? []) {
      if (u.deleted) continue;
      users.push({
        id: u.id!,
        name: u.name,
        real_name: u.real_name,
        display_name: u.profile?.display_name,
        is_bot: u.is_bot,
        deleted: u.deleted,
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor && users.length < limit);

  return users;
}

export async function getChannelHistory(input: { channel: string; limit?: number; oldest?: string; latest?: string; cursor?: string }) {
  const client = getClient();
  const channel = await resolveChannelId(input.channel);
  const res = await callSlack(() =>
    client.conversations.history({
      channel,
      limit: input.limit ?? 50,
      oldest: input.oldest,
      latest: input.latest,
      cursor: input.cursor,
    })
  );
  return {
    channel,
    messages: res.messages ?? [],
    hasMore: Boolean(res.has_more),
    nextCursor: res.response_metadata?.next_cursor,
  };
}

export async function getThread(input: { channel: string; threadTs: string; limit?: number }) {
  const client = getClient();
  const channel = await resolveChannelId(input.channel);
  const res = await callSlack(() =>
    client.conversations.replies({
      channel,
      ts: input.threadTs,
      limit: input.limit ?? 50,
    })
  );
  return {
    channel,
    threadTs: input.threadTs,
    messages: res.messages ?? [],
    hasMore: Boolean(res.has_more),
  };
}

export async function searchHistory(query: string, count = 20) {
  const client = getClient();
  const q = String(query ?? '').trim();
  if (!q) throw new SlackServiceError('search query is required', 'query_required', 400);

  // search.messages requires a user token with search:read in many workspaces;
  // fall back to scanning recent channel history when the bot token lacks it.
  try {
    const res = await callSlack(() =>
      client.search.messages({
        query: q,
        count,
        sort: 'timestamp',
        sort_dir: 'desc',
      })
    );
    return {
      query: q,
      matches: (res.messages as any)?.matches ?? [],
      total: (res.messages as any)?.total ?? 0,
      source: 'search.messages' as const,
    };
  } catch (err) {
    if (!(err instanceof SlackServiceError) || (err.code !== 'missing_permissions' && err.code !== 'not_allowed_token_type' && !/not_allowed|missing/i.test(err.message))) {
      // continue to fallback for permission-style failures only
      if (!(err instanceof SlackServiceError)) throw err;
      if (!['missing_permissions', 'invalid_token', 'slack_error'].includes(err.code) && !/missing_scope|not_allowed|paid_teams_only/i.test(err.message + err.code)) {
        throw err;
      }
    }

    const channels = await listChannels(30);
    const matches: Array<Record<string, unknown>> = [];
    const lower = q.toLowerCase();
    for (const ch of channels.slice(0, 10)) {
      if (!ch.is_member && ch.is_private) continue;
      try {
        const hist = await getChannelHistory({ channel: ch.id, limit: 30 });
        for (const msg of hist.messages) {
          const text = String((msg as any).text ?? '');
          if (text.toLowerCase().includes(lower)) {
            matches.push({
              channel: { id: ch.id, name: ch.name },
              text,
              ts: (msg as any).ts,
              user: (msg as any).user,
            });
          }
          if (matches.length >= count) break;
        }
      } catch {
        // skip channels the bot can't read
      }
      if (matches.length >= count) break;
    }
    return { query: q, matches, total: matches.length, source: 'history_scan' as const };
  }
}

export async function uploadFile(input: {
  channels: string | string[];
  content?: string;
  filename?: string;
  title?: string;
  initialComment?: string;
  file?: Buffer;
}) {
  const client = getClient();
  const channelList = Array.isArray(input.channels) ? input.channels : [input.channels];
  const channelIds = await Promise.all(channelList.map((c) => resolveChannelId(c)));

  if (input.file) {
    const res = await callSlack(() =>
      (client as any).filesUploadV2({
        channel_id: channelIds[0],
        file: input.file,
        filename: input.filename ?? 'upload.bin',
        title: input.title,
        initial_comment: input.initialComment,
      })
    );
    return { ok: true, files: (res as any).files ?? res, channels: channelIds };
  }

  const res = await callSlack(() =>
    (client as any).filesUploadV2({
      channel_id: channelIds[0],
      content: input.content ?? '',
      filename: input.filename ?? 'note.txt',
      title: input.title ?? input.filename ?? 'Upload',
      initial_comment: input.initialComment,
    })
  );
  return { ok: true, files: (res as any).files ?? res, channels: channelIds };
}

export async function addReaction(input: { channel: string; timestamp: string; name: string }) {
  const client = getClient();
  const channel = await resolveChannelId(input.channel);
  const name = String(input.name ?? '').replace(/:/g, '');
  await callSlack(() =>
    client.reactions.add({
      channel,
      timestamp: input.timestamp,
      name,
    })
  );
  return { ok: true, channel, timestamp: input.timestamp, name };
}

export async function createChannel(input: { name: string; isPrivate?: boolean }) {
  const client = getClient();
  const name = String(input.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  if (!name) throw new SlackServiceError('channel name is required', 'name_required', 400);

  const res = await callSlack(() =>
    client.conversations.create({
      name,
      is_private: Boolean(input.isPrivate),
    })
  );
  return {
    ok: true,
    id: res.channel?.id,
    name: res.channel?.name,
    isPrivate: res.channel?.is_private,
  };
}

export async function inviteUsers(input: { channel: string; users: string | string[] }) {
  const client = getClient();
  const channel = await resolveChannelId(input.channel);
  const users = (Array.isArray(input.users) ? input.users : String(input.users).split(','))
    .map((u) => u.trim())
    .filter(Boolean);
  if (!users.length) throw new SlackServiceError('users is required', 'users_required', 400);

  const res = await callSlack(() =>
    client.conversations.invite({
      channel,
      users: users.join(','),
    })
  );
  return { ok: true, channel: res.channel?.id ?? channel, invited: users };
}

export const slackService = {
  initializeClient,
  getClient,
  verifySlackSignature,
  authTest,
  getWorkspaceInfo,
  resolveChannelId,
  postMessage,
  postExternalMessage,
  listChannels,
  listUsers,
  getChannelHistory,
  getThread,
  searchHistory,
  uploadFile,
  addReaction,
  createChannel,
  inviteUsers,
};

export default slackService;
