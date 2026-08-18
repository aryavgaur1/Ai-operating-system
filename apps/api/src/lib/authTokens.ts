import crypto from 'crypto';
import type { CookieOptions, Response } from 'express';
import { query } from '@enterprise-ai-os/stores';
import { signAccessToken, signRefreshToken } from '../middleware/auth';
import { assertActiveMembership } from './workspaceAuth';

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function webAppUrl(): string {
  return (process.env.WEB_APP_URL ?? process.env.NEXT_PUBLIC_API_URL?.replace(':4000', ':3000') ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** Cross-site SPA (Netlify) → API (Railway) needs SameSite=None; Secure. */
function refreshCookieOptions(maxAgeMs: number): CookieOptions {
  const web = webAppUrl();
  const local = /localhost|127\.0\.0\.1/i.test(web);
  const crossSite = !local && Boolean(process.env.RAILWAY_PUBLIC_DOMAIN || process.env.API_PUBLIC_URL);
  return {
    httpOnly: true,
    secure: !local,
    sameSite: crossSite || !local ? 'none' : 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie('nexora_refresh', refreshCookieOptions(0));
}

export async function issueSession(
  res: Response,
  userId: string,
  organizationId: string,
  opts: { rememberMe?: boolean; userAgent?: string; ip?: string } = {}
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken(userId, organizationId);
  const refreshToken = signRefreshToken(userId, organizationId, Boolean(opts.rememberMe));
  const tokenHash = hashToken(refreshToken);
  const days = opts.rememberMe ? 30 : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await query(
    `insert into refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expiresAt.toISOString(), opts.userAgent ?? null, opts.ip ?? null]
  );

  res.cookie('nexora_refresh', refreshToken, refreshCookieOptions(days * 24 * 60 * 60 * 1000));

  return { accessToken, refreshToken };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await query(`update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null`, [
    hashToken(raw),
  ]);
}

export async function rotateRefreshToken(
  res: Response,
  raw: string,
  opts: { userAgent?: string; ip?: string } = {}
): Promise<{ accessToken: string; refreshToken: string; userId: string; organizationId: string } | null> {
  const tokenHash = hashToken(raw);
  const result = await query<{ user_id: string; expires_at: Date }>(
    `select user_id, expires_at from refresh_tokens
     where token_hash = $1 and revoked_at is null`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row || new Date(row.expires_at) < new Date()) return null;

  await query(`update refresh_tokens set revoked_at = now() where token_hash = $1`, [tokenHash]);

  const user = await query<{ organization_id: string; active_organization_id: string | null }>(
    `select organization_id, active_organization_id from users where id = $1`,
    [row.user_id]
  );
  const homeOrg = user.rows[0]?.organization_id;
  if (!homeOrg) return null;

  // Prefer active org only when membership is active; else home (membership-validated at authenticate).
  let orgId = user.rows[0]?.active_organization_id || homeOrg;
  try {
    await assertActiveMembership(row.user_id, orgId);
  } catch {
    orgId = homeOrg;
    try {
      await assertActiveMembership(row.user_id, orgId);
    } catch {
      return null;
    }
  }

  const session = await issueSession(res, row.user_id, orgId, opts);
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId: row.user_id,
    organizationId: orgId,
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function parseUserAgent(ua: string | undefined): { device: string; browser: string; os: string } {
  if (!ua) return { device: 'Unknown device', browser: 'Unknown browser', os: 'Unknown' };
  const device = /Mobi|Android/i.test(ua) ? 'Mobile' : /iPad|Tablet/i.test(ua) ? 'Tablet' : 'Desktop';
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS|Macintosh/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Unknown';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'Unknown browser';
  return { device, browser, os };
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await query(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
}
