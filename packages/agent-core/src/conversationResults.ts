import type { ApprovalRequest, ToolCallResult } from '@enterprise-ai-os/shared';
import { query } from '@enterprise-ai-os/stores';

/** Durable chat message for a verified (or failed) Approve & Run result. */
export function formatApprovalExecutionMessage(
  approval: ApprovalRequest,
  result: ToolCallResult
): string {
  const label = `${approval.tool}.${approval.action}`;
  const out = (result.output || {}) as Record<string, unknown>;
  if (!result.ok || result.mocked) {
    return [
      `✕ ${label} failed`,
      result.error ? `Error: ${result.error}` : null,
      result.mocked ? 'Verified: ✕ Mock result refused' : 'Verified: ✕ No',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const lines: string[] = [`✓ ${label} completed successfully.`];
  if (approval.tool === 'jira') {
    const key = String(out.key || out.id || '').trim();
    const summary = String(approval.input?.summary || approval.input?.title || out.summary || '').trim();
    if (key) lines.push(`Jira: ${key}`);
    if (summary) lines.push(`Title: ${summary}`);
    if (out.url) lines.push(`View: ${out.url}`);
  } else if (approval.tool === 'slack') {
    const channel = String(out.channel || approval.input?.channel || '').trim();
    const ts = String(out.ts || '').trim();
    if (channel) lines.push(`Channel: ${channel}`);
    if (ts) lines.push(`ts: ${ts}`);
    if (out.url) lines.push(`View: ${out.url}`);
  } else if (approval.tool === 'notion') {
    const id = String(out.id || out.pageId || '').trim();
    const title = String(approval.input?.title || out.title || '').trim();
    if (title) lines.push(`Title: ${title}`);
    if (id) lines.push(`pageId: ${id}`);
    if (out.url) lines.push(`View: ${out.url}`);
  } else {
    const key = String(out.key || out.id || out.ts || '').trim();
    if (key) lines.push(`Result: ${key}`);
    if (out.url) lines.push(`View: ${out.url}`);
  }
  lines.push(
    approval.executionVerified || (result.ok && !result.mocked)
      ? 'Verified: ✓ External verification passed'
      : 'Verified: ✕ No'
  );
  return lines.join('\n');
}

/**
 * Persist Approve & Run outcome into the originating conversation.
 * Source of truth is backend messages — not sessionStorage flash.
 */
export async function persistApprovalResultToConversation(
  approval: ApprovalRequest,
  result: ToolCallResult
): Promise<void> {
  const conversationId = approval.conversationId?.trim();
  if (!conversationId) return;
  if ((process.env.SAAS_MODE ?? 'true') !== 'true' || !process.env.DATABASE_URL) return;

  const content = formatApprovalExecutionMessage(
    { ...approval, executionVerified: result.ok && !result.mocked },
    result
  );
  const toolCalls = {
    kind: 'approval_execution_result',
    approvalId: approval.id,
    tool: approval.tool,
    action: approval.action,
    ok: result.ok,
    mocked: result.mocked,
    verified: result.ok && !result.mocked,
    output: result.output ?? null,
    error: result.error ?? null,
  };

  try {
    const owned = await query(
      `select id from conversations where id = $1 and organization_id = $2`,
      [conversationId, approval.organizationId]
    );
    if (!owned.rows[0]) return;

    await query(
      `insert into messages (conversation_id, role, content, tool_calls)
       values ($1, 'assistant', $2, $3)`,
      [conversationId, content, JSON.stringify(toolCalls)]
    );
    await query(`update conversations set updated_at = now() where id = $1`, [conversationId]);
  } catch (err) {
    console.warn(
      '[approvals] persist result to conversation failed:',
      err instanceof Error ? err.message : err
    );
  }
}
