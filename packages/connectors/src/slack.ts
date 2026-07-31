import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';
import {
  slackService,
  SlackServiceError,
  getChannelHistory,
  listChannels,
  postMessage,
  postExternalMessage,
  searchHistory,
  uploadFile,
  addReaction,
  createChannel,
  inviteUsers,
  listUsers,
  getThread,
  authTest,
} from './slackService';

// ============================================================
// Slack Connector
// Live wiring: @slack/web-api WebClient via slack_service,
// authorized with SLACK_BOT_TOKEN (same pattern as Notion's
// NOTION_API_KEY). Toggle with SLACK_MODE=live.
// Webhooks: Slack Events API (message.channels, app_mention,
// reaction_added) — signature verified in the API routes layer.
// ============================================================

const MOCK_MESSAGES: NormalizedDoc[] = [
  {
    externalId: 'C01-1700000001.000100',
    resourceType: 'message',
    title: '#project-phoenix',
    url: 'https://mock-workspace.slack.com/archives/C01/p1700000001000100',
    text: "Heads up — Project Phoenix is going to slip by about a week, we're blocked on the vendor API contract.",
    metadata: { channel: 'project-phoenix', user: 'U-priya', ts: '1700000001.000100' },
  },
  {
    externalId: 'C01-1700000050.000200',
    resourceType: 'message',
    title: '#project-phoenix',
    url: 'https://mock-workspace.slack.com/archives/C01/p1700000050000200',
    text: 'Vendor contract signed this morning — unblocking the integration work now.',
    metadata: { channel: 'project-phoenix', user: 'U-arjun', ts: '1700000050.000200' },
  },
  {
    externalId: 'C02-1700000090.000300',
    resourceType: 'message',
    title: '#client-acme-corp',
    url: 'https://mock-workspace.slack.com/archives/C02/p1700000090000300',
    text: 'Acme Corp asked for an updated timeline on the dashboard rollout — can someone confirm the new date?',
    metadata: { channel: 'client-acme-corp', user: 'U-meera', ts: '1700000090.000300' },
  },
];

const LIVE_ACTIONS = [
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
];

function workspaceUrl(channelId: string, ts?: string): string {
  const team = process.env.SLACK_TEAM_DOMAIN ?? 'workspace';
  if (ts) {
    const p = ts.replace('.', '');
    return `https://${team}.slack.com/archives/${channelId}/p${p}`;
  }
  return `https://${team}.slack.com/archives/${channelId}`;
}

class SlackConnector implements ToolConnector {
  tool = 'slack' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    if (isLiveMode('slack')) {
      try {
        slackService.initializeClient();
        const channels = await listChannels(20);
        const items: NormalizedDoc[] = [];
        let nextCursor: string | undefined;

        for (const ch of channels.filter((c) => c.is_member !== false).slice(0, 5)) {
          try {
            const hist = await getChannelHistory({
              channel: ch.id,
              limit: 10,
              oldest: sinceCursor,
            });
            for (const msg of hist.messages) {
              const text = String((msg as any).text ?? '').trim();
              if (!text) continue;
              const ts = String((msg as any).ts ?? '');
              items.push({
                externalId: `${ch.id}-${ts}`,
                resourceType: 'message',
                title: `#${ch.name ?? ch.id}`,
                url: workspaceUrl(ch.id, ts),
                text,
                metadata: {
                  channel: ch.name ?? ch.id,
                  channelId: ch.id,
                  user: (msg as any).user,
                  ts,
                },
              });
            }
            if (hist.nextCursor) nextCursor = hist.nextCursor;
          } catch {
            // Bot may lack access to some channels — skip.
          }
        }

        return { items, nextCursor };
      } catch (err: any) {
        console.warn('[slack.fetchRecent] live ingest skipped:', err?.message ?? err);
        return { items: [], nextCursor: undefined };
      }
    }

    await simulateLatency();
    return { items: MOCK_MESSAGES, nextCursor: undefined };
  }

  async handleWebhook(payload: unknown): Promise<NormalizedDoc[]> {
    const body = payload as {
      type?: string;
      event?: {
        type?: string;
        channel?: string;
        user?: string;
        text?: string;
        ts?: string;
        thread_ts?: string;
        item?: { channel?: string; ts?: string };
        reaction?: string;
      };
      event_id?: string;
      team_id?: string;
      // mock / simplified shape
      channel?: string;
      user?: string;
      text?: string;
      ts?: string;
    };

    // Live Events API envelope
    const event = body.event;
    if (event) {
      if (event.type === 'message' || event.type === 'app_mention') {
        const text = String(event.text ?? '').trim();
        if (!text) return [];
        const channel = event.channel ?? 'unknown';
        const ts = event.ts ?? String(Date.now() / 1000);
        return [
          {
            externalId: `${channel}-${ts}`,
            resourceType: 'message',
            title: `#${channel}`,
            url: workspaceUrl(channel, ts),
            text,
            metadata: {
              channel,
              user: event.user,
              ts,
              thread_ts: event.thread_ts,
              eventType: event.type,
              teamId: body.team_id,
              eventId: body.event_id,
            },
          },
        ];
      }

      if (event.type === 'reaction_added') {
        const channel = event.item?.channel ?? 'unknown';
        const ts = event.item?.ts ?? String(Date.now() / 1000);
        return [
          {
            externalId: `${channel}-${ts}-reaction-${event.reaction ?? 'unknown'}`,
            resourceType: 'message',
            title: `#${channel} reaction`,
            url: workspaceUrl(channel, ts),
            text: `Reaction :${event.reaction}: added by ${event.user ?? 'unknown'}`,
            metadata: {
              channel,
              user: event.user,
              ts,
              reaction: event.reaction,
              eventType: event.type,
              teamId: body.team_id,
              eventId: body.event_id,
            },
          },
        ];
      }

      return [];
    }

    // Mock / simplified payload
    await simulateLatency(20, 60);
    if (!body?.text) return [];
    return [
      {
        externalId: `${body.channel ?? 'unknown'}-${body.ts ?? Date.now()}`,
        resourceType: 'message',
        title: `#${body.channel ?? 'unknown'}`,
        url: `https://mock-workspace.slack.com/archives/${body.channel ?? 'unknown'}`,
        text: body.text,
        metadata: { channel: body.channel, user: body.user, ts: body.ts },
      },
    ];
  }

  listActions(): string[] {
    if (isLiveMode('slack')) return [...LIVE_ACTIONS];
    return ['postMessage', 'postMessageExternalChannel'];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    if (isLiveMode('slack')) {
      slackService.initializeClient();
      try {
        switch (action) {
          case 'postMessage': {
            const requestedChannel = String(input.channel ?? '');
            const result = await postMessage({
              channel: requestedChannel,
              text: String(input.text ?? ''),
              threadTs: input.threadTs as string | undefined,
            });
            return {
              tool: 'slack',
              action,
              ok: true,
              output: { ...result, channelName: requestedChannel.replace(/^#/, '') },
              mocked: false,
            };
          }

          case 'postMessageExternalChannel': {
            const requestedChannel = String(input.channel ?? '');
            const result = await postExternalMessage({
              channel: requestedChannel,
              text: String(input.text ?? ''),
              threadTs: input.threadTs as string | undefined,
            });
            return {
              tool: 'slack',
              action,
              ok: true,
              output: { ...result, channelName: requestedChannel.replace(/^#/, '') },
              mocked: false,
            };
          }

          case 'listChannels': {
            const channels = await listChannels(Number(input.limit ?? 200));
            return { tool: 'slack', action, ok: true, output: { channels }, mocked: false };
          }

          case 'listUsers': {
            const users = await listUsers(Number(input.limit ?? 200));
            return { tool: 'slack', action, ok: true, output: { users }, mocked: false };
          }

          case 'getChannelHistory': {
            const result = await getChannelHistory({
              channel: String(input.channel ?? ''),
              limit: Number(input.limit ?? 50),
              oldest: input.oldest as string | undefined,
              latest: input.latest as string | undefined,
              cursor: input.cursor as string | undefined,
            });
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          case 'getThread': {
            const result = await getThread({
              channel: String(input.channel ?? ''),
              threadTs: String(input.threadTs ?? input.ts ?? ''),
              limit: Number(input.limit ?? 50),
            });
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          case 'searchHistory': {
            const result = await searchHistory(String(input.query ?? input.text ?? ''), Number(input.count ?? 20));
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          case 'summarizeChannel': {
            const channel = String(input.channel ?? 'general');
            const hist = await getChannelHistory({ channel, limit: Number(input.limit ?? 30) });
            const lines = (hist.messages ?? [])
              .map((m: any) => `- ${m.user ?? 'unknown'}: ${String(m.text ?? '').trim()}`)
              .filter((l: string) => l.length > 10)
              .slice(0, 30);
            const summary =
              lines.length === 0
                ? `No recent messages found in #${channel.replace(/^#/, '')}.`
                : `Recent activity in #${String(hist.channel)} (${lines.length} messages):\n${lines.join('\n')}`;
            return {
              tool: 'slack',
              action,
              ok: true,
              output: { channel: hist.channel, messageCount: hist.messages.length, summary },
              mocked: false,
            };
          }

          case 'uploadFile': {
            const result = await uploadFile({
              channels: (input.channels as string) ?? (input.channel as string) ?? 'general',
              content: input.content as string | undefined,
              filename: (input.filename as string) ?? 'upload.txt',
              title: input.title as string | undefined,
              initialComment: (input.initialComment as string) ?? (input.comment as string) ?? undefined,
              file: input.file as Buffer | undefined,
            });
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          case 'addReaction': {
            const result = await addReaction({
              channel: String(input.channel ?? ''),
              timestamp: String(input.timestamp ?? input.ts ?? ''),
              name: String(input.name ?? input.reaction ?? 'thumbsup'),
            });
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          case 'createChannel': {
            const result = await createChannel({
              name: String(input.name ?? input.channel ?? ''),
              isPrivate: Boolean(input.isPrivate),
            });
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          case 'inviteUsers': {
            const result = await inviteUsers({
              channel: String(input.channel ?? ''),
              users: (input.users as string | string[]) ?? (input.user as string) ?? '',
            });
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          case 'authTest': {
            const result = await authTest();
            return { tool: 'slack', action, ok: true, output: result, mocked: false };
          }

          default:
            return { tool: 'slack', action, ok: false, error: `Unknown action: ${action}`, mocked: false };
        }
      } catch (err: any) {
        const message = err instanceof SlackServiceError ? err.message : err?.message ?? String(err);
        return { tool: 'slack', action, ok: false, error: message, mocked: false };
      }
    }

    await simulateLatency();
    if (action === 'postMessage' || action === 'postMessageExternalChannel') {
      console.log(`[MOCK slack.${action}]`, input);
      return {
        tool: 'slack',
        action,
        ok: true,
        output: { channel: input.channel, ts: `${Date.now() / 1000}`, text: input.text },
        mocked: true,
      };
    }
    return { tool: 'slack', action, ok: false, error: `Unknown action: ${action}`, mocked: true };
  }
}

export const slackConnector = new SlackConnector();
