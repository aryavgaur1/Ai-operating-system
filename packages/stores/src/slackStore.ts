import { query } from './postgres';

// ============================================================
// Slack persistence — installations, inbound Events API payloads,
// and per-action audit logs. Uses Postgres (same DATABASE_URL as
// the rest of the system of record). All writes are best-effort:
// a missing DB must never break a live Slack API call.
// ============================================================

export interface SlackInstallationRow {
  id: string;
  organization_id: string;
  team_id: string | null;
  team_name: string | null;
  bot_user_id: string | null;
  app_id: string | null;
  scopes: string | null;
  status: string;
  installed_at: Date;
  last_synced_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface SlackActionLogInput {
  organizationId?: string;
  userId?: string;
  workspace?: string;
  action: string;
  payload?: Record<string, unknown>;
  status: 'ok' | 'error' | string;
  error?: string;
  executionTimeMs?: number;
}

export interface SlackEventInput {
  organizationId?: string;
  eventId?: string;
  eventType: string;
  teamId?: string;
  channelId?: string;
  userId?: string;
  payload: Record<string, unknown>;
}

async function safeQuery(text: string, params: unknown[] = []): Promise<boolean> {
  try {
    await query(text, params);
    return true;
  } catch (err) {
    console.warn('[slackStore] write skipped:', err instanceof Error ? err.message : err);
    return false;
  }
}

export async function upsertSlackInstallation(input: {
  organizationId: string;
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  appId?: string;
  scopes?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await safeQuery(
    `insert into slack_installations
      (organization_id, team_id, team_name, bot_user_id, app_id, scopes, status, last_synced_at, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, now(), $8::jsonb)
     on conflict (organization_id, team_id)
     do update set
       team_name = excluded.team_name,
       bot_user_id = excluded.bot_user_id,
       app_id = excluded.app_id,
       scopes = coalesce(excluded.scopes, slack_installations.scopes),
       status = excluded.status,
       last_synced_at = now(),
       metadata = slack_installations.metadata || excluded.metadata`,
    [
      input.organizationId,
      input.teamId ?? null,
      input.teamName ?? null,
      input.botUserId ?? null,
      input.appId ?? null,
      input.scopes ?? null,
      input.status ?? 'active',
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

export async function getSlackInstallation(organizationId: string): Promise<SlackInstallationRow | null> {
  try {
    const res = await query<SlackInstallationRow>(
      `select * from slack_installations
       where organization_id = $1
       order by last_synced_at desc nulls last, installed_at desc
       limit 1`,
      [organizationId]
    );
    return res.rows[0] ?? null;
  } catch (err) {
    console.warn('[slackStore] read skipped:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Resolve Nexora org from Slack team id (interactive approvals workspace binding). */
export async function findOrganizationBySlackTeam(
  teamId: string
): Promise<{ organizationId: string; metadata: Record<string, unknown> } | null> {
  const tid = String(teamId || '').trim();
  if (!tid) return null;
  try {
    const res = await query<SlackInstallationRow>(
      `select * from slack_installations
       where team_id = $1 and status = 'active'
       order by last_synced_at desc nulls last, installed_at desc
       limit 1`,
      [tid]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      organizationId: row.organization_id,
      metadata: (row.metadata as Record<string, unknown>) || {},
    };
  } catch (err) {
    console.warn('[slackStore] team lookup skipped:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function storeSlackEvent(input: SlackEventInput): Promise<void> {
  await safeQuery(
    `insert into slack_events
      (organization_id, event_id, event_type, team_id, channel_id, user_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.organizationId ?? null,
      input.eventId ?? null,
      input.eventType,
      input.teamId ?? null,
      input.channelId ?? null,
      input.userId ?? null,
      JSON.stringify(input.payload ?? {}),
    ]
  );
}

export async function listSlackEvents(limit = 50): Promise<Record<string, unknown>[]> {
  try {
    const res = await query(
      `select id, organization_id, event_id, event_type, team_id, channel_id, user_id, payload, received_at
       from slack_events
       order by received_at desc
       limit $1`,
      [limit]
    );
    return res.rows;
  } catch (err) {
    console.warn('[slackStore] list events skipped:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function logSlackAction(input: SlackActionLogInput): Promise<void> {
  await safeQuery(
    `insert into slack_action_logs
      (organization_id, user_id, workspace, action, payload, status, error, execution_time_ms)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [
      input.organizationId ?? null,
      input.userId ?? null,
      input.workspace ?? null,
      input.action,
      JSON.stringify(input.payload ?? {}),
      input.status,
      input.error ?? null,
      input.executionTimeMs ?? null,
    ]
  );
}
