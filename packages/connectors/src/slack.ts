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
  setChannelTopic,
  setChannelPurpose,
  pinMessage,
  createBookmark,
  createCanvas,
  scheduleReminder,
  listPins,
  searchFiles,
  findUsersByRole,
} from './slackService';
import * as intelligence from './slackIntelligence';

// ============================================================
// Slack Connector — core CRUD preserved; enterprise AI workflows
// composed in slackIntelligence.ts (war rooms, incidents, digests).
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
  'setChannelTopic',
  'setChannelPurpose',
  'pinMessage',
  'listPins',
  'createBookmark',
  'createCanvas',
  'scheduleReminder',
  'searchFiles',
  'findUsersByRole',
  'createWarRoom',
  'createIncident',
  'summarizeThread',
  'findBlockers',
  'findUnansweredMessages',
  'findCustomerComplaints',
  'detectActionItems',
  'followUpPendingReplies',
  'dailyDigest',
  'weeklyDigest',
  'semanticSearch',
  'detectDeadChannels',
  'findDecision',
  'findOwner',
  'generateMeetingNotes',
];

function workspaceUrl(channelId: string, ts?: string): string {
  const team = process.env.SLACK_TEAM_DOMAIN ?? 'workspace';
  if (ts) {
    const p = ts.replace('.', '');
    return `https://${team}.slack.com/archives/${channelId}/p${p}`;
  }
  return `https://${team}.slack.com/archives/${channelId}`;
}

function okResult(action: string, output: unknown): ToolCallResult {
  return { tool: 'slack', action, ok: true, output, mocked: false };
}

function failResult(action: string, error: string): ToolCallResult {
  return { tool: 'slack', action, ok: false, error, mocked: false };
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
            // skip inaccessible channels
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
      channel?: string;
      user?: string;
      text?: string;
      ts?: string;
    };

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
      try {
        slackService.initializeClient();
      } catch (err) {
        return failResult(
          action,
          err instanceof Error
            ? err.message
            : 'Slack is not connected for this user. Connect Slack in Integrations.'
        );
      }
      try {
        switch (action) {
          case 'postMessage': {
            const requestedChannel = String(input.channel ?? '');
            const result = await postMessage({
              channel: requestedChannel,
              text: String(input.text ?? ''),
              threadTs: input.threadTs as string | undefined,
            });
            return okResult(action, { ...result, channelName: requestedChannel.replace(/^#/, '') });
          }
          case 'postMessageExternalChannel': {
            const requestedChannel = String(input.channel ?? '');
            const result = await postExternalMessage({
              channel: requestedChannel,
              text: String(input.text ?? ''),
              threadTs: input.threadTs as string | undefined,
            });
            return okResult(action, { ...result, channelName: requestedChannel.replace(/^#/, '') });
          }
          case 'listChannels':
            return okResult(action, { channels: await listChannels(Number(input.limit ?? 200)) });
          case 'listUsers':
            return okResult(action, { users: await listUsers(Number(input.limit ?? 200)) });
          case 'getChannelHistory':
            return okResult(
              action,
              await getChannelHistory({
                channel: String(input.channel ?? ''),
                limit: Number(input.limit ?? 50),
                oldest: input.oldest as string | undefined,
                latest: input.latest as string | undefined,
                cursor: input.cursor as string | undefined,
              })
            );
          case 'getThread':
            return okResult(
              action,
              await getThread({
                channel: String(input.channel ?? ''),
                threadTs: String(input.threadTs ?? input.ts ?? ''),
                limit: Number(input.limit ?? 50),
              })
            );
          case 'searchHistory':
            return okResult(
              action,
              await searchHistory(String(input.query ?? input.text ?? ''), Number(input.count ?? 20))
            );
          case 'summarizeChannel':
            return okResult(
              action,
              await intelligence.summarizeChannelDeep({
                channel: String(input.channel ?? 'general'),
                limit: Number(input.limit ?? 40),
                focus: input.focus as string | undefined,
              })
            );
          case 'uploadFile':
            return okResult(
              action,
              await uploadFile({
                channels: (input.channels as string) ?? (input.channel as string) ?? 'general',
                content: input.content as string | undefined,
                filename: (input.filename as string) ?? 'upload.txt',
                title: input.title as string | undefined,
                initialComment: (input.initialComment as string) ?? (input.comment as string) ?? undefined,
                file: input.file as Buffer | undefined,
              })
            );
          case 'addReaction':
            return okResult(
              action,
              await addReaction({
                channel: String(input.channel ?? ''),
                timestamp: String(input.timestamp ?? input.ts ?? ''),
                name: String(input.name ?? input.reaction ?? 'thumbsup'),
              })
            );
          case 'createChannel': {
            const result = await createChannel({
              name: String(input.name ?? input.channel ?? ''),
              isPrivate: Boolean(input.isPrivate),
            });
            if (!result.id) return failResult(action, 'Slack createChannel returned no channel id');
            return okResult(action, result);
          }
          case 'inviteUsers':
            return okResult(
              action,
              await inviteUsers({
                channel: String(input.channel ?? ''),
                users: (input.users as string | string[]) ?? (input.user as string) ?? '',
                roles: input.roles as string[] | undefined,
              })
            );
          case 'authTest':
            return okResult(action, await authTest());
          case 'setChannelTopic':
            return okResult(
              action,
              await setChannelTopic({
                channel: String(input.channel ?? ''),
                topic: String(input.topic ?? input.text ?? ''),
              })
            );
          case 'setChannelPurpose':
            return okResult(
              action,
              await setChannelPurpose({
                channel: String(input.channel ?? ''),
                purpose: String(input.purpose ?? input.text ?? ''),
              })
            );
          case 'pinMessage':
            return okResult(
              action,
              await pinMessage({
                channel: String(input.channel ?? ''),
                timestamp: String(input.timestamp ?? input.ts ?? ''),
              })
            );
          case 'listPins':
            return okResult(action, await listPins({ channel: String(input.channel ?? '') }));
          case 'createBookmark':
            return okResult(
              action,
              await createBookmark({
                channel: String(input.channel ?? ''),
                title: String(input.title ?? 'Bookmark'),
                link: String(input.link ?? input.url ?? ''),
                emoji: input.emoji as string | undefined,
              })
            );
          case 'createCanvas':
            return okResult(
              action,
              await createCanvas({
                title: String(input.title ?? 'Nexora Canvas'),
                markdown: String(input.markdown ?? input.content ?? input.text ?? ''),
                channel: input.channel as string | undefined,
              })
            );
          case 'scheduleReminder': {
            const postAt =
              Number(input.postAt) ||
              Math.floor(Date.now() / 1000) + Number(input.inMinutes ?? 60) * 60;
            return okResult(
              action,
              await scheduleReminder({
                channel: String(input.channel ?? ''),
                text: String(input.text ?? input.message ?? 'Reminder from Nexora'),
                postAt,
              })
            );
          }
          case 'searchFiles':
            return okResult(action, await searchFiles(String(input.query ?? ''), Number(input.count ?? 20)));
          case 'findUsersByRole': {
            const roles = Array.isArray(input.roles)
              ? (input.roles as string[])
              : String(input.roles ?? input.role ?? '')
                  .split(/[,/]| and /i)
                  .map((r) => r.trim())
                  .filter(Boolean);
            return okResult(action, { users: await findUsersByRole(roles) });
          }
          case 'createWarRoom':
            return okResult(
              action,
              await intelligence.createWarRoom({
                name: input.name as string | undefined,
                project: (input.project as string) ?? (input.name as string) ?? undefined,
                topic: input.topic as string | undefined,
                roles: input.roles as string[] | undefined,
                docs: input.docs as string[] | undefined,
                roadmap: input.roadmap as string | undefined,
              })
            );
          case 'createIncident':
            return okResult(
              action,
              await intelligence.createIncident({
                name: input.name as string | undefined,
                severity: input.severity as string | undefined,
                summary: (input.summary as string) ?? (input.text as string) ?? undefined,
                roles: input.roles as string[] | undefined,
              })
            );
          case 'summarizeThread':
            return okResult(
              action,
              await intelligence.summarizeThread({
                channel: String(input.channel ?? ''),
                threadTs: String(input.threadTs ?? input.ts ?? ''),
                limit: Number(input.limit ?? 80),
              })
            );
          case 'findBlockers':
            return okResult(
              action,
              await intelligence.findBlockers({
                query: input.query as string | undefined,
                channel: input.channel as string | undefined,
                limit: Number(input.limit ?? 30),
              })
            );
          case 'findUnansweredMessages':
            return okResult(
              action,
              await intelligence.findUnansweredMessages({
                channel: input.channel as string | undefined,
                olderThanHours: Number(input.olderThanHours ?? 4),
                limit: Number(input.limit ?? 40),
              })
            );
          case 'findCustomerComplaints':
            return okResult(
              action,
              await intelligence.findCustomerComplaints({
                query: input.query as string | undefined,
                limit: Number(input.limit ?? 30),
              })
            );
          case 'detectActionItems':
            return okResult(
              action,
              await intelligence.detectActionItems({
                channel: input.channel as string | undefined,
                query: input.query as string | undefined,
                limit: Number(input.limit ?? 40),
              })
            );
          case 'followUpPendingReplies':
            return okResult(
              action,
              await intelligence.followUpPendingReplies({
                channel: input.channel as string | undefined,
                dryRun: Boolean(input.dryRun),
                olderThanHours: Number(input.olderThanHours ?? 6),
              })
            );
          case 'dailyDigest':
            return okResult(
              action,
              await intelligence.dailyDigest({
                channels: input.channels as string[] | undefined,
                limit: Number(input.limit ?? 25),
              })
            );
          case 'weeklyDigest':
            return okResult(
              action,
              await intelligence.weeklyDigest({
                channels: input.channels as string[] | undefined,
                limit: Number(input.limit ?? 60),
              })
            );
          case 'semanticSearch':
            return okResult(
              action,
              await intelligence.semanticSearch({
                query: String(input.query ?? input.text ?? ''),
                count: Number(input.count ?? 20),
              })
            );
          case 'detectDeadChannels':
            return okResult(
              action,
              await intelligence.detectDeadChannels({
                idleDays: Number(input.idleDays ?? 14),
                limit: Number(input.limit ?? 40),
              })
            );
          case 'findDecision':
            return okResult(
              action,
              await intelligence.findDecision({ query: String(input.query ?? input.text ?? '') })
            );
          case 'findOwner':
            return okResult(
              action,
              await intelligence.findOwner({
                topic: String(input.topic ?? input.query ?? input.text ?? ''),
              })
            );
          case 'generateMeetingNotes':
            return okResult(
              action,
              await intelligence.generateMeetingNotes({
                channel: String(input.channel ?? 'general'),
                limit: Number(input.limit ?? 50),
              })
            );
          default:
            return failResult(action, `Unknown action: ${action}`);
        }
      } catch (err: any) {
        const message = err instanceof SlackServiceError ? err.message : err?.message ?? String(err);
        return failResult(action, message);
      }
    }

    await simulateLatency();
    console.warn(`[MOCK slack.${action}] blocked from reporting fake success — SLACK_MODE is not live`);
    return {
      tool: 'slack',
      action,
      ok: false,
      error:
        'Slack is in MOCK mode. Set SLACK_MODE=live and SLACK_BOT_TOKEN in .env — refusing to fake a successful create/post.',
      mocked: true,
    };
  }
}

export const slackConnector = new SlackConnector();
