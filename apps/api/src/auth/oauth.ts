import crypto from 'crypto';
import type { ToolName } from '@enterprise-ai-os/shared';

// ============================================================
// OAuth & Access Token Manager
// - Encrypts tokens at rest using real AES-256-GCM (not mocked —
//   this part matters even in a demo, since it's easy to get
//   wrong later). The key comes from TOKEN_ENCRYPTION_KEY.
// - Storage is an in-memory map for this scaffold so the API
//   runs with zero infra. Swap `store`/`load` below for reads and
//   writes against the `oauth_connections` table (db/schema.sql)
//   to persist across restarts — the encrypt/decrypt calls don't
//   need to change.
// ============================================================

interface StoredConnection {
  organizationId: string;
  userId?: string;
  tool: ToolName;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  expiresAt?: string;
  status: 'active' | 'revoked' | 'error';
}

const connections = new Map<string, StoredConnection>();

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length < 32) {
    // Dev fallback so the demo runs without a real secret configured.
    // A real deployment MUST set a proper 32-byte hex key.
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

function connectionKey(organizationId: string, tool: ToolName, userId?: string): string {
  return `${organizationId}:${tool}:${userId ?? 'org-level'}`;
}

export function storeConnection(
  organizationId: string,
  tool: ToolName,
  accessToken: string,
  opts: { userId?: string; refreshToken?: string; expiresAt?: string } = {}
): void {
  connections.set(connectionKey(organizationId, tool, opts.userId), {
    organizationId,
    userId: opts.userId,
    tool,
    encryptedAccessToken: encryptToken(accessToken),
    encryptedRefreshToken: opts.refreshToken ? encryptToken(opts.refreshToken) : undefined,
    expiresAt: opts.expiresAt,
    status: 'active',
  });
}

export function getAccessToken(organizationId: string, tool: ToolName, userId?: string): string | undefined {
  const conn = connections.get(connectionKey(organizationId, tool, userId));
  if (!conn || conn.status !== 'active') return undefined;
  return decryptToken(conn.encryptedAccessToken);
}

export function revokeConnection(organizationId: string, tool: ToolName, userId?: string): void {
  const key = connectionKey(organizationId, tool, userId);
  const conn = connections.get(key);
  if (conn) connections.set(key, { ...conn, status: 'revoked' });
}

export function listConnections(organizationId: string): { tool: ToolName; status: string; userId?: string }[] {
  return [...connections.values()]
    .filter((c) => c.organizationId === organizationId)
    .map((c) => ({ tool: c.tool, status: c.status, userId: c.userId }));
}

// Seed a demo "active" connection for every tool so the
// integrations dashboard has something to show out of the box.
export function seedDemoConnections(organizationId: string): void {
  const tools: ToolName[] = ['slack', 'jira', 'gmail', 'salesforce', 'notion'];
  for (const tool of tools) {
    const liveSlackToken =
      tool === 'slack' && process.env.SLACK_MODE === 'live' && process.env.SLACK_BOT_TOKEN
        ? process.env.SLACK_BOT_TOKEN.trim()
        : undefined;
    storeConnection(organizationId, tool, liveSlackToken ?? `demo-access-token-${tool}`, {
      refreshToken: `demo-refresh-token-${tool}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    });
  }
}
