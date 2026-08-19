import { isLiveMode } from './base';
import { initializeClient, postBlocks, postMessage } from './slackService';

/**
 * In-Slack Approve & Run cards.
 * Set SLACK_APPROVALS_CHANNEL=#approvals (or channel ID) on the API.
 */

export function getApprovalsChannel(): string | undefined {
  const raw = process.env.SLACK_APPROVALS_CHANNEL?.trim();
  return raw || undefined;
}

export function buildApprovalBlocks(input: {
  approvalId: string;
  tool: string;
  action: string;
  riskLevel?: string;
  summary?: string;
  webAppUrl?: string;
  /** Required — binds button to exact approval fingerprint (P0.3.3). */
  payloadFingerprint: string;
}): { text: string; blocks: unknown[] } {
  const web = (input.webAppUrl || process.env.WEB_APP_URL || 'https://nexoraos.co.in').replace(/\/$/, '');
  const summary = (input.summary || `${input.tool}.${input.action}`).slice(0, 500);
  const text = `Pending approval: ${input.tool}.${input.action} (${input.approvalId})`;
  const buttonValue = encodeApprovalButtonValue(input.approvalId, input.payloadFingerprint);
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Nexora — Approve & Run', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Tool*\n\`${input.tool}.${input.action}\`` },
        { type: 'mrkdwn', text: `*Risk*\n${input.riskLevel ?? 'high'}` },
        { type: 'mrkdwn', text: `*Approval ID*\n\`${input.approvalId}\`` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Summary*\n${summary}` },
    },
    {
      type: 'actions',
      block_id: `nexora_approval_${input.approvalId}`,
      elements: [
        {
          type: 'button',
          action_id: 'nexora_approve_run',
          text: { type: 'plain_text', text: 'Approve & Run', emoji: true },
          style: 'primary',
          value: buttonValue,
        },
        {
          type: 'button',
          action_id: 'nexora_reject',
          text: { type: 'plain_text', text: 'Reject', emoji: true },
          style: 'danger',
          value: buttonValue,
        },
        {
          type: 'button',
          action_id: 'nexora_open_web',
          text: { type: 'plain_text', text: 'Open Approvals', emoji: true },
          url: `${web}/app/approvals`,
        },
      ],
    },
  ];
  return { text, blocks };
}

/** Button value binds approval id to integrity fingerprint — cannot swap action by id alone. */
export function encodeApprovalButtonValue(approvalId: string, fingerprint: string): string {
  return `${String(approvalId).trim()}|${String(fingerprint).trim()}`;
}

export function parseApprovalButtonValue(raw: string): { approvalId: string; fingerprint: string } | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const idx = s.indexOf('|');
  if (idx <= 0) {
    // Legacy buttons (id only) — refuse in interactive path
    return null;
  }
  const approvalId = s.slice(0, idx).trim();
  const fingerprint = s.slice(idx + 1).trim();
  if (!approvalId || !fingerprint || fingerprint.length < 32) return null;
  return { approvalId, fingerprint };
}

export async function notifyPendingApproval(input: {
  approvalId: string;
  tool: string;
  action: string;
  riskLevel?: string;
  summary?: string;
  channel?: string;
  payloadFingerprint: string;
}): Promise<{ ok: boolean; skipped?: boolean; channel?: string; ts?: string; error?: string }> {
  const channel = input.channel || getApprovalsChannel();
  if (!channel) return { ok: true, skipped: true };
  if (!isLiveMode('slack')) return { ok: true, skipped: true, error: 'slack_not_live' };
  if (!input.payloadFingerprint?.trim()) {
    return { ok: false, error: 'missing_payload_fingerprint' };
  }

  try {
    initializeClient();
    const { text, blocks } = buildApprovalBlocks({
      approvalId: input.approvalId,
      tool: input.tool,
      action: input.action,
      riskLevel: input.riskLevel,
      summary: input.summary,
      payloadFingerprint: input.payloadFingerprint,
    });
    const posted = await postBlocks({ channel, text, blocks });
    return { ok: true, channel: String(posted.channel ?? channel), ts: posted.ts };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function replyApprovalOutcome(input: {
  channel: string;
  threadTs?: string;
  text: string;
}): Promise<void> {
  if (!isLiveMode('slack')) return;
  try {
    initializeClient();
    await postMessage({
      channel: input.channel,
      text: input.text,
      threadTs: input.threadTs,
    });
  } catch {
    // non-fatal
  }
}
