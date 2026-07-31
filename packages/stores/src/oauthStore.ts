import crypto from 'crypto';

// ============================================================
// OAuth & Access Token Manager — persisted in Postgres
// (oauth_connections table, db/schema.sql). Lives in the shared
// `stores` package (not apps/api) so both the API server and
// packages/connectors can resolve a user's real token without
// a package ever depending on an app.
// Tokens are encrypted at rest with AES-256-GCM before being
// written to the database.
// ============================================================

import { query } from './postgres';

export type ToolName = 'slack' | 'jira' | 'gmail' | 'salesforce' | 'notion';

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length < 32) {
    return crypto.createHash('sha256').update('dev-only-insecure-key').digest();
  }
  return crypto.createHash('sha256').update(hex).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export async function storeConnection(
  organizationId: string,
  tool: ToolName,
  accessToken: string,
  opts: { userId?: string; refreshToken?: string; expiresAt?: string; scope?: string } = {}
): Promise<void> {
  const encryptedAccessToken = encryptToken(accessToken);
  const encryptedRefreshToken = opts.refreshToken ? encryptToken(opts.refreshToken) : null;

  await query(
    `insert into oauth_connections
       (organization_id, user_id, tool, scope, encrypted_access_token, encrypted_refresh_token, expires_at, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'active')
     on conflict (organization_id, user_id, tool)
     do update set
       scope = excluded.scope,
       encrypted_access_token = excluded.encrypted_access_token,
       encrypted_refresh_token = excluded.encrypted_refresh_token,
       expires_at = excluded.expires_at,
       status = 'active',
       updated_at = now()`,
    [organizationId, opts.userId ?? null, tool, opts.scope ?? null, encryptedAccessToken, encryptedRefreshToken, opts.expiresAt ?? null]
  );
}

export async function getAccessToken(
  organizationId: string,
  tool: ToolName,
  userId?: string
): Promise<string | undefined> {
  const result = await query<{ encrypted_access_token: string }>(
    `select encrypted_access_token from oauth_connections
     where organization_id = $1 and tool = $2 and status = 'active'
       and (
         ($3::text is not null and (user_id::text = $3::text or user_id is null))
         or ($3::text is null and user_id is null)
       )
     order by case when user_id::text = $3::text then 0 else 1 end, updated_at desc
     limit 1`,
    [organizationId, tool, userId ?? null]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return decryptToken(row.encrypted_access_token);
}

export async function revokeConnection(organizationId: string, tool: ToolName, userId?: string): Promise<void> {
  await query(
    `update oauth_connections set status = 'revoked', updated_at = now()
     where organization_id = $1 and tool = $2
       and (user_id = $3 or ($3 is null and user_id is null))`,
    [organizationId, tool, userId ?? null]
  );
}

export async function listConnections(
  organizationId: string,
  userId?: string
): Promise<{ tool: ToolName; status: string; userId?: string }[]> {
  const result = await query<{ tool: ToolName; status: string; user_id: string | null }>(
    userId
      ? `select tool, status, user_id from oauth_connections
         where organization_id = $1 and (user_id = $2 or user_id is null)
         order by updated_at desc`
      : `select tool, status, user_id from oauth_connections where organization_id = $1 order by updated_at desc`,
    userId ? [organizationId, userId] : [organizationId]
  );
  return result.rows.map((r) => ({ tool: r.tool, status: r.status, userId: r.user_id ?? undefined }));
}

// Seeds a demo "active" connection for every tool except Notion
// (which real users connect for real via /oauth/notion/start), so a
// brand-new organization's integrations dashboard isn't empty.
export async function seedDemoConnections(organizationId: string): Promise<void> {
  const tools: ToolName[] = ['slack', 'jira', 'gmail', 'salesforce'];
  for (const tool of tools) {
    await storeConnection(organizationId, tool, `demo-access-token-${tool}`, {
      refreshToken: `demo-refresh-token-${tool}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    });
  }
}
