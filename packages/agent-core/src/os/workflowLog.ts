import { query } from '@enterprise-ai-os/stores';
import type { OsIntent, WorkflowStepResult } from '@enterprise-ai-os/shared';

// ============================================================
// STEP 10 — Action / workflow logging
// ============================================================

export interface WorkflowLogInput {
  organizationId: string;
  userId?: string;
  query: string;
  intent: OsIntent;
  reasoning: string[];
  planSteps: string[];
  steps: WorkflowStepResult[];
  retries: number;
  durationMs: number;
  success: boolean;
  replyPreview?: string;
}

const recentLogs: WorkflowLogInput[] = [];

export function getRecentWorkflowLogs(limit = 50): WorkflowLogInput[] {
  return recentLogs.slice(0, limit);
}

export async function logWorkflow(input: WorkflowLogInput): Promise<void> {
  recentLogs.unshift(input);
  if (recentLogs.length > 200) recentLogs.length = 200;

  try {
    await query(
      `insert into workflow_runs
        (organization_id, user_id, query, intent_kind, intent, reasoning, plan_steps, steps, retries, duration_ms, success, reply_preview)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
      [
        input.organizationId,
        input.userId ?? null,
        input.query,
        input.intent.kind,
        JSON.stringify(input.intent),
        JSON.stringify(input.reasoning),
        JSON.stringify(input.planSteps),
        JSON.stringify(input.steps),
        input.retries,
        input.durationMs,
        input.success,
        input.replyPreview?.slice(0, 500) ?? null,
      ]
    );
  } catch (err) {
    console.warn('[workflow_runs] persist skipped:', err instanceof Error ? err.message : err);
  }
}

export async function listWorkflowRuns(organizationId: string, limit = 50): Promise<Record<string, unknown>[]> {
  try {
    const res = await query(
      `select id, organization_id, user_id, query, intent_kind, intent, reasoning, plan_steps, steps,
              retries, duration_ms, success, reply_preview, created_at
       from workflow_runs
       where organization_id = $1
       order by created_at desc
       limit $2`,
      [organizationId, limit]
    );
    return res.rows;
  } catch {
    return getRecentWorkflowLogs(limit).filter((l) => l.organizationId === organizationId) as unknown as Record<
      string,
      unknown
    >[];
  }
}
