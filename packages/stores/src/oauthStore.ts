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

export type ConnectionMetadata = Record<string, unknown>;

export interface ConnectionDetails {
  tool: ToolName;
  status: string;
  userId?: string;
  scope?: string;
  connectedAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
  metadata: ConnectionMetadata;
  /** Never include plaintext tokens — flags only */
  hasAccessToken: boolean;
  hasUserToken: boolean;
  hasRefreshToken: boolean;
}

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
  opts: {
    userId?: string;
    refreshToken?: string;
    /** Slack user OAuth token (xoxp-) — stored in encrypted_user_token */
    userAccessToken?: string;
    expiresAt?: string;
    scope?: string;
    metadata?: ConnectionMetadata;
  } = {}
): Promise<void> {
  const encryptedAccessToken = encryptToken(accessToken);
  const encryptedRefreshToken = opts.refreshToken ? encryptToken(opts.refreshToken) : null;
  const encryptedUserToken = opts.userAccessToken ? encryptToken(opts.userAccessToken) : null;
  const metadataJson = JSON.stringify(opts.metadata ?? {});

  await query(
    `insert into oauth_connections
       (organization_id, user_id, tool, scope, encrypted_access_token, encrypted_refresh_token,
        encrypted_user_token, expires_at, status, metadata, last_used_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9::jsonb, now())
     on conflict (organization_id, user_id, tool)
     do update set
       scope = excluded.scope,
       encrypted_access_token = excluded.encrypted_access_token,
       encrypted_refresh_token = coalesce(excluded.encrypted_refresh_token, oauth_connections.encrypted_refresh_token),
       encrypted_user_token = coalesce(excluded.encrypted_user_token, oauth_connections.encrypted_user_token),
       expires_at = excluded.expires_at,
       status = 'active',
       metadata = oauth_connections.metadata || excluded.metadata,
       last_used_at = now(),
       updated_at = now()`,
    [
      organizationId,
      opts.userId ?? null,
      tool,
      opts.scope ?? null,
      encryptedAccessToken,
      encryptedRefreshToken,
      encryptedUserToken,
      opts.expiresAt ?? null,
      metadataJson,
    ]
  );
}

async function selectConnectionRow(
  organizationId: string,
  tool: ToolName,
  userId?: string
): Promise<{
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  encrypted_user_token: string | null;
} | undefined> {
  const result = await query<{
    encrypted_access_token: string;
    encrypted_refresh_token: string | null;
    encrypted_user_token: string | null;
  }>(
    `select encrypted_access_token, encrypted_refresh_token, encrypted_user_token
     from oauth_connections
     where organization_id = $1 and tool = $2 and status = 'active'
       and (
         ($3::text is not null and (user_id::text = $3::text or user_id is null))
         or ($3::text is null and user_id is null)
       )
     order by case when user_id::text = $3::text then 0 else 1 end, updated_at desc
     limit 1`,
    [organizationId, tool, userId ?? null]
  );
  return result.rows[0];
}

export async function getAccessToken(
  organizationId: string,
  tool: ToolName,
  userId?: string
): Promise<string | undefined> {
  const row = await selectConnectionRow(organizationId, tool, userId);
  if (!row) return undefined;
  return decryptToken(row.encrypted_access_token);
}

/** Slack user OAuth token (xoxp-). Prefers encrypted_user_token; falls back to legacy refresh column. */
export async function getSlackUserToken(
  organizationId: string,
  userId?: string
): Promise<string | undefined> {
  const row = await selectConnectionRow(organizationId, 'slack', userId);
  if (!row) return undefined;
  const enc = row.encrypted_user_token || row.encrypted_refresh_token;
  if (!enc) return undefined;
  try {
    return decryptToken(enc);
  } catch {
    return undefined;
  }
}

export async function touchConnectionLastUsed(
  organizationId: string,
  tool: ToolName,
  userId?: string
): Promise<void> {
  await query(
    `update oauth_connections set last_used_at = now(), updated_at = now()
     where organization_id = $1 and tool = $2 and status = 'active'
       and (user_id = $3 or ($3 is null and user_id is null))`,
    [organizationId, tool, userId ?? null]
  ).catch(() => undefined);
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

/** Safe connection details for Integrations / Admin — never returns plaintext tokens. */
export async function getConnectionDetails(
  organizationId: string,
  userId?: string,
  tool?: ToolName
): Promise<ConnectionDetails[]> {
  const result = await query<{
    tool: ToolName;
    status: string;
    user_id: string | null;
    scope: string | null;
    created_at: Date;
    updated_at: Date;
    last_used_at: Date | null;
    metadata: ConnectionMetadata | null;
    encrypted_access_token: string | null;
    encrypted_user_token: string | null;
    encrypted_refresh_token: string | null;
  }>(
    `select tool, status, user_id, scope, created_at, updated_at, last_used_at, metadata,
            encrypted_access_token, encrypted_user_token, encrypted_refresh_token
     from oauth_connections
     where organization_id = $1
       and ($2::text is null or user_id::text = $2::text or user_id is null)
       and ($3::text is null or tool = $3)
     order by updated_at desc`,
    [organizationId, userId ?? null, tool ?? null]
  );

  return result.rows.map((r) => ({
    tool: r.tool,
    status: r.status,
    userId: r.user_id ?? undefined,
    scope: r.scope ?? undefined,
    connectedAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    updatedAt: r.updated_at?.toISOString?.() ?? String(r.updated_at),
    lastUsedAt: r.last_used_at ? (r.last_used_at.toISOString?.() ?? String(r.last_used_at)) : undefined,
    metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as ConnectionMetadata,
    hasAccessToken: Boolean(r.encrypted_access_token),
    hasUserToken: Boolean(r.encrypted_user_token || (r.tool === 'slack' && r.encrypted_refresh_token)),
    hasRefreshToken: Boolean(r.encrypted_refresh_token),
  }));
}

/** Admin inventory across orgs — never decrypts tokens. */
export async function listAllConnectionDetails(limit = 200): Promise<
  Array<
    ConnectionDetails & {
      organizationId: string;
      email?: string;
      displayName?: string;
      workspaceName?: string;
    }
  >
> {
  const result = await query<{
    organization_id: string;
    tool: ToolName;
    status: string;
    user_id: string | null;
    scope: string | null;
    created_at: Date;
    updated_at: Date;
    last_used_at: Date | null;
    metadata: ConnectionMetadata | null;
    encrypted_access_token: string | null;
    encrypted_user_token: string | null;
    encrypted_refresh_token: string | null;
    email: string | null;
    display_name: string | null;
    org_name: string | null;
  }>(
    `select oc.organization_id, oc.tool, oc.status, oc.user_id, oc.scope,
            oc.created_at, oc.updated_at, oc.last_used_at, oc.metadata,
            oc.encrypted_access_token, oc.encrypted_user_token, oc.encrypted_refresh_token,
            u.email, u.display_name, o.name as org_name
     from oauth_connections oc
     left join users u on u.id = oc.user_id
     left join organizations o on o.id = oc.organization_id
     order by oc.updated_at desc
     limit $1`,
    [limit]
  );

  return result.rows.map((r) => {
    const metadata = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as ConnectionMetadata;
    return {
      organizationId: r.organization_id,
      tool: r.tool,
      status: r.status,
      userId: r.user_id ?? undefined,
      scope: r.scope ?? undefined,
      connectedAt: r.created_at?.toISOString?.() ?? String(r.created_at),
      updatedAt: r.updated_at?.toISOString?.() ?? String(r.updated_at),
      lastUsedAt: r.last_used_at ? (r.last_used_at.toISOString?.() ?? String(r.last_used_at)) : undefined,
      metadata,
      hasAccessToken: Boolean(r.encrypted_access_token),
      hasUserToken: Boolean(r.encrypted_user_token || (r.tool === 'slack' && r.encrypted_refresh_token)),
      hasRefreshToken: Boolean(r.encrypted_refresh_token),
      email: r.email ?? undefined,
      displayName: r.display_name ?? undefined,
      workspaceName:
        (typeof metadata.teamName === 'string' && metadata.teamName) ||
        (typeof metadata.workspaceName === 'string' && metadata.workspaceName) ||
        r.org_name ||
        undefined,
    };
  });
}

// Demo connection seeding disabled — never invent "active" OAuth rows.
export async function seedDemoConnections(_organizationId: string): Promise<void> {
  console.warn('[oauthStore] seedDemoConnections skipped — demo tokens are disabled');
}
