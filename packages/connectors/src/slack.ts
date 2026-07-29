import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';

// ============================================================
// Slack Connector
// Live wiring point: @slack/web-api's WebClient, using the
// per-user encrypted OAuth token from oauth_connections.
// Webhooks: Slack "Events API" (message.channels, etc).
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

class SlackConnector implements ToolConnector {
  tool = 'slack' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): const client = new WebClient(accessToken);
      // TODO(live): const res = await client.conversations.history({ channel, cursor: sinceCursor });
      // TODO(live): return normalize(res.messages)
      throw new Error('Slack live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
    return { items: MOCK_MESSAGES, nextCursor: undefined };
  }

  async handleWebhook(payload: unknown): Promise<NormalizedDoc[]> {
    await simulateLatency(20, 60);
    // TODO(live): validate Slack signing secret, parse event.type === 'message'
    const p = payload as { channel?: string; user?: string; text?: string; ts?: string };
    if (!p?.text) return [];
    return [
      {
        externalId: `${p.channel ?? 'unknown'}-${p.ts ?? Date.now()}`,
        resourceType: 'message',
        title: `#${p.channel ?? 'unknown'}`,
        url: `https://mock-workspace.slack.com/archives/${p.channel ?? 'unknown'}`,
        text: p.text,
        metadata: { channel: p.channel, user: p.user, ts: p.ts },
      },
    ];
  }

  listActions(): string[] {
    return ['postMessage', 'postMessageExternalChannel'];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): const client = new WebClient(accessToken);
      // TODO(live): await client.chat.postMessage({ channel: input.channel, text: input.text });
      throw new Error('Slack live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
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
