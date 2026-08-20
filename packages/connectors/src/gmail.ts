import type { ToolCallResult } from '@enterprise-ai-os/shared';
import { type ToolConnector, type FetchPage, type NormalizedDoc, notConnectedResult } from './base';
import { getConnectorContext } from './context';

// ============================================================
// Gmail Connector — real Gmail REST API over HTTPS.
// Per-user OAuth2 tokens injected via ConnectorContext.
// NEVER uses the server GMAIL_REFRESH_TOKEN (that is for
// the invitation mailer only — a completely separate credential).
// ============================================================

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveGmailToken(): string {
  const ctx = getConnectorContext();
  const token = ctx.gmailToken?.trim();
  if (token) return token;
  if (ctx.saasStrict) {
    throw new Error(
      'Gmail is not connected for this workspace. Connect Gmail under Integrations → Gmail.'
    );
  }
  throw new Error(
    'Gmail is not connected. Open Integrations → Connect Gmail, then try again.'
  );
}

async function gmailFetch(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
}

function humanizeGmailError(status: number, body: string): string {
  if (status === 401 || /invalid.?token|unauthorized|oauth/i.test(body)) {
    return 'Gmail connection needs to be reauthorized. Open Integrations → Disconnect Gmail → Connect Gmail.';
  }
  if (status === 403 || /permission|forbidden|insufficientPermissions/i.test(body)) {
    return 'Gmail denied the request — insufficient permissions. Reconnect Gmail and allow all requested scopes.';
  }
  if (status === 429 || /rateLimitExceeded|quota/i.test(body)) {
    return 'Gmail API rate limit reached. Wait a moment and try again.';
  }
  if (status >= 500) {
    return 'Gmail is temporarily unavailable. Try again in a moment.';
  }
  return `Gmail API error (${status}): ${body.slice(0, 200)}`;
}

/**
 * Decode a Gmail message part body (base64url → utf-8 string).
 */
function decodeBody(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Extract text content from a Gmail message payload (recursive).
 * Prefers text/plain; falls back to text/html (stripped).
 */
function extractBody(
  payload: {
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: unknown[];
  },
  maxChars = 2000
): string {
  if (!payload) return '';

  const mime = payload.mimeType ?? '';

  // Leaf node with body data
  if (payload.body?.data) {
    const text = decodeBody(payload.body.data);
    if (mime === 'text/plain') return text.slice(0, maxChars);
    if (mime === 'text/html') {
      // Strip HTML tags crudely — good enough for search grounding
      return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
    }
  }

  // Multipart — prefer plain text part
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts as typeof payload[]) {
      if ((part as typeof payload).mimeType === 'text/plain') {
        const t = extractBody(part as typeof payload, maxChars);
        if (t) return t;
      }
    }
    for (const part of payload.parts as typeof payload[]) {
      const t = extractBody(part as typeof payload, maxChars);
      if (t) return t;
    }
  }

  return '';
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  );
}

interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  };
}

function normalizeMessage(msg: GmailMessage, userEmail: string | null): NormalizedDoc {
  const headers = msg.payload?.headers ?? [];
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const from = getHeader(headers, 'From') || '';
  const to = getHeader(headers, 'To') || '';
  const date = msg.internalDate
    ? new Date(parseInt(msg.internalDate)).toISOString()
    : '';
  const body = msg.payload ? extractBody(msg.payload) : (msg.snippet ?? '');
  const labels = Array.isArray(msg.labelIds) ? msg.labelIds : [];

  return {
    externalId: msg.id,
    resourceType: 'email',
    title: `${subject} — from ${from}`,
    url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
    text: `From: ${from}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\nLabels: ${labels.join(', ')}\n\n${body}`,
    metadata: {
      threadId: msg.threadId,
      subject,
      from,
      to,
      date,
      snippet: msg.snippet ?? '',
      labels,
      gmailAccount: userEmail,
    },
  };
}

// ─── Connector class ──────────────────────────────────────────────────────────

class GmailConnector implements ToolConnector {
  tool = 'gmail' as const;

  async fetchRecent(sinceCursor?: string): Promise<FetchPage> {
    let token: string;
    try {
      token = resolveGmailToken();
    } catch {
      return { items: [], nextCursor: undefined };
    }

    const ctx = getConnectorContext();
    const userEmail = ctx.gmailEmail ?? null;

    const params = new URLSearchParams({ maxResults: '20' });
    if (sinceCursor) params.set('pageToken', sinceCursor);

    const listRes = await gmailFetch(
      `/users/me/messages?${params.toString()}`,
      token
    );
    if (!listRes.ok) {
      const body = await listRes.text();
      console.warn('[gmail] fetchRecent list failed', listRes.status, body.slice(0, 200));
      return { items: [], nextCursor: undefined };
    }

    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    };

    const messageIds = (listData.messages ?? []).map((m) => m.id);
    const items: NormalizedDoc[] = [];

    for (const id of messageIds) {
      const msgRes = await gmailFetch(
        `/users/me/messages/${id}?format=full`,
        token
      );
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as GmailMessage;
      items.push(normalizeMessage(msg, userEmail));
    }

    return { items, nextCursor: listData.nextPageToken };
  }

  async handleWebhook(_payload: unknown): Promise<NormalizedDoc[]> {
    return [];
  }

  listActions(): string[] {
    return ['searchEmails', 'getThread', 'sendEmail', 'getEmail'];
  }

  async execute(
    action: string,
    input: Record<string, unknown>
  ): Promise<ToolCallResult> {
    let token: string;
    try {
      token = resolveGmailToken();
    } catch (err) {
      return notConnectedResult('gmail', action);
    }

    const ctx = getConnectorContext();
    const userEmail = ctx.gmailEmail ?? null;

    try {
      switch (action) {
        case 'searchEmails':
          return await this._searchEmails(token, userEmail, input);
        case 'getEmail':
          return await this._getEmail(token, userEmail, input);
        case 'getThread':
          return await this._getThread(token, userEmail, input);
        case 'sendEmail':
          return await this._sendEmail(token, userEmail, input);
        default:
          return {
            tool: 'gmail',
            action,
            ok: false,
            error: `Unknown Gmail action: ${action}. Available: searchEmails, getEmail, getThread, sendEmail.`,
            mocked: false,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[gmail] execute error', { action, message: msg });
      return { tool: 'gmail', action, ok: false, error: msg, mocked: false };
    }
  }

  // ─── Action implementations ────────────────────────────────────────────────

  private async _searchEmails(
    token: string,
    userEmail: string | null,
    input: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const q = String(input.query ?? input.q ?? '');
    if (!q.trim()) {
      return {
        tool: 'gmail',
        action: 'searchEmails',
        ok: false,
        error: 'Provide a search query, e.g. { query: "from:acme.com subject:invoice" }',
        mocked: false,
      };
    }

    const maxResults = Math.min(Number(input.maxResults ?? 10), 20);
    const params = new URLSearchParams({ q, maxResults: String(maxResults) });

    const listRes = await gmailFetch(`/users/me/messages?${params.toString()}`, token);
    if (!listRes.ok) {
      const body = await listRes.text();
      console.warn('[gmail] searchEmails_fail', {
        status: listRes.status,
        query: q.slice(0, 120),
      });
      return {
        tool: 'gmail',
        action: 'searchEmails',
        ok: false,
        error: humanizeGmailError(listRes.status, body),
        mocked: false,
      };
    }

    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
      resultSizeEstimate?: number;
    };

    const messageIds = (listData.messages ?? []).map((m) => m.id);
    console.info('[gmail] searchEmails', {
      query: q.slice(0, 160),
      resultCount: messageIds.length,
      estimate: listData.resultSizeEstimate ?? null,
      account: userEmail,
      status: 'ok',
    });
    if (!messageIds.length) {
      return {
        tool: 'gmail',
        action: 'searchEmails',
        ok: true,
        output: { emails: [], count: 0, query: q, account: userEmail },
        mocked: false,
      };
    }

    const emails: NormalizedDoc[] = [];
    for (const id of messageIds) {
      const msgRes = await gmailFetch(`/users/me/messages/${id}?format=full`, token);
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as GmailMessage;
      emails.push(normalizeMessage(msg, userEmail));
    }

    return {
      tool: 'gmail',
      action: 'searchEmails',
      ok: true,
      output: {
        emails,
        count: emails.length,
        query: q,
        account: userEmail,
      },
      mocked: false,
    };
  }

  private async _getEmail(
    token: string,
    userEmail: string | null,
    input: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const id = String(input.messageId ?? input.id ?? '').trim();
    if (!id) {
      return {
        tool: 'gmail',
        action: 'getEmail',
        ok: false,
        error: 'Provide { messageId: "<gmail message id>" }',
        mocked: false,
      };
    }

    const msgRes = await gmailFetch(`/users/me/messages/${id}?format=full`, token);
    if (!msgRes.ok) {
      const body = await msgRes.text();
      return {
        tool: 'gmail',
        action: 'getEmail',
        ok: false,
        error: humanizeGmailError(msgRes.status, body),
        mocked: false,
      };
    }

    const msg = (await msgRes.json()) as GmailMessage;
    return {
      tool: 'gmail',
      action: 'getEmail',
      ok: true,
      output: { email: normalizeMessage(msg, userEmail), account: userEmail },
      mocked: false,
    };
  }

  private async _getThread(
    token: string,
    userEmail: string | null,
    input: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const threadId = String(input.threadId ?? '').trim();
    if (!threadId) {
      return {
        tool: 'gmail',
        action: 'getThread',
        ok: false,
        error: 'Provide { threadId: "<gmail thread id>" }',
        mocked: false,
      };
    }

    const threadRes = await gmailFetch(
      `/users/me/threads/${threadId}?format=full`,
      token
    );
    if (!threadRes.ok) {
      const body = await threadRes.text();
      return {
        tool: 'gmail',
        action: 'getThread',
        ok: false,
        error: humanizeGmailError(threadRes.status, body),
        mocked: false,
      };
    }

    const thread = (await threadRes.json()) as {
      id: string;
      messages?: GmailMessage[];
      snippet?: string;
    };

    const messages = (thread.messages ?? []).map((m) =>
      normalizeMessage(m, userEmail)
    );

    return {
      tool: 'gmail',
      action: 'getThread',
      ok: true,
      output: {
        threadId: thread.id,
        messageCount: messages.length,
        messages,
        account: userEmail,
      },
      mocked: false,
    };
  }

  private async _sendEmail(
    token: string,
    userEmail: string | null,
    input: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const to = String(input.to ?? '').trim();
    const subject = String(input.subject ?? '').trim();
    const body = String(input.body ?? input.text ?? '').trim();

    if (!to || !subject || !body) {
      return {
        tool: 'gmail',
        action: 'sendEmail',
        ok: false,
        error: 'Provide { to, subject, body } — all three are required to send an email.',
        mocked: false,
      };
    }

    // Build RFC 2822 message
    const from = userEmail ? `me <${userEmail}>` : 'me';
    const date = new Date().toUTCString();
    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@nexora-os>`;
    const rawLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      `Message-ID: ${msgId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ];
    const raw = Buffer.from(rawLines.join('\r\n'), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendRes = await gmailFetch('/users/me/messages/send', token, {
      method: 'POST',
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      return {
        tool: 'gmail',
        action: 'sendEmail',
        ok: false,
        error: humanizeGmailError(sendRes.status, errBody),
        mocked: false,
      };
    }

    const sent = (await sendRes.json()) as { id: string; threadId?: string };
    return {
      tool: 'gmail',
      action: 'sendEmail',
      ok: true,
      output: {
        messageId: sent.id,
        threadId: sent.threadId,
        to,
        subject,
        account: userEmail,
        url: `https://mail.google.com/mail/u/0/#sent/${sent.id}`,
      },
      mocked: false,
    };
  }
}

export const gmailConnector = new GmailConnector();
