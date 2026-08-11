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
}): { text: string; blocks: unknown[] } {
  const web = (input.webAppUrl || process.env.WEB_APP_URL || 'https://try-nexora.netlify.app').replace(/\/$/, '');
  const summary = (input.summary || `${input.tool}.${input.action}`).slice(0, 500);
  const text = `Pending approval: ${input.tool}.${input.action} (${input.approvalId})`;
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
          value: input.approvalId,
        },
        {
          type: 'button',
          action_id: 'nexora_reject',
          text: { type: 'plain_text', text: 'Reject', emoji: true },
          style: 'danger',
          value: input.approvalId,
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

export async function notifyPendingApproval(input: {
  approvalId: string;
  tool: string;
  action: string;
  riskLevel?: string;
  summary?: string;
  channel?: string;
}): Promise<{ ok: boolean; skipped?: boolean; channel?: string; ts?: string; error?: string }> {
  const channel = input.channel || getApprovalsChannel();
  if (!channel) return { ok: true, skipped: true };
  if (!isLiveMode('slack')) return { ok: true, skipped: true, error: 'slack_not_live' };

  try {
    initializeClient();
    const { text, blocks } = buildApprovalBlocks(input);
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
