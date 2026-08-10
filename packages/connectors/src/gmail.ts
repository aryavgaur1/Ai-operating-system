import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { simulateLatency, isLiveMode, type ToolConnector, type FetchPage, type NormalizedDoc } from './base';

// ============================================================
// Gmail Connector
// Live wiring point: googleapis' gmail v1 client, authorized via
// Google OAuth 2.0 with incremental scopes (readonly by default,
// send only if the user explicitly grants it).
// Webhooks: Gmail push notifications via Cloud Pub/Sub.
// ============================================================

const MOCK_EMAILS: NormalizedDoc[] = [
  {
    externalId: 'thread-991a',
    resourceType: 'email',
    title: 'Re: Dashboard rollout timeline',
    url: 'https://mail.google.com/mail/u/0/#inbox/thread-991a',
    text: "Hi team, following up — Acme Corp's stakeholders want a firm rollout date for the dashboard by Friday.",
    metadata: { from: 'contact@acmecorp.example', to: 'meera@ourcompany.example', labels: ['INBOX', 'IMPORTANT'] },
  },
  {
    externalId: 'thread-882b',
    resourceType: 'email',
    title: 'Vendor contract — signed copy attached',
    url: 'https://mail.google.com/mail/u/0/#inbox/thread-882b',
    text: 'Please find the countersigned vendor agreement attached. Integration work can proceed.',
    metadata: { from: 'legal@vendor.example', to: 'arjun@ourcompany.example', labels: ['INBOX'] },
  },
];

class GmailConnector implements ToolConnector {
  tool = 'gmail' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    await simulateLatency();
    if (isLiveMode()) {
      // TODO(live): gmail.users.messages.list({ userId: 'me', pageToken: sinceCursor })
      throw new Error('Gmail live mode not implemented yet — set CONNECTORS_MODE=mock.');
    }
    return { items: MOCK_EMAILS, nextCursor: undefined };
  }

  async handleWebhook(payload: unknown): Promise<NormalizedDoc[]> {
    await simulateLatency(20, 60);
    // TODO(live): decode Pub/Sub push message, call gmail.users.history.list to get the delta
    const p = payload as { threadId?: string; snippet?: string; from?: string };
    if (!p?.threadId) return [];
    return [
      {
        externalId: p.threadId,
        resourceType: 'email',
        title: p.snippet?.slice(0, 60) ?? 'New email',
        url: `https://mail.google.com/mail/u/0/#inbox/${p.threadId}`,
        text: p.snippet ?? '',
        metadata: { from: p.from },
      },
    ];
  }

  listActions(): string[] {
    return ['sendEmail', 'deleteEmail'];
  }

  async execute(action: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    await simulateLatency();
    // Never report fake success — Gmail OAuth send is not wired yet.
    if (isLiveMode('gmail')) {
      return {
        tool: 'gmail',
        action,
        ok: false,
        error:
          'Gmail live send is not connected yet. Connect Gmail under Integrations (when available), or use Slack/Jira/Notion for live actions.',
        mocked: false,
      };
    }
    console.warn(`[MOCK gmail.${action}] blocked from reporting fake success`);
    return {
      tool: 'gmail',
      action,
      ok: false,
      error:
        'Gmail is not live. Refusing to fake a successful send — connect a live mailbox integration or use Slack/Jira/Notion.',
      mocked: true,
    };
  }
}

export const gmailConnector = new GmailConnector();
