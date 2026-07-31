import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ActingUser } from '@enterprise-ai-os/shared';
import { query } from '@enterprise-ai-os/stores';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: ActingUser;
    }
  }
}

interface JwtPayload {
  sub: string;
  org: string;
  typ?: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'replace-with-a-long-random-string') {
    // Dev fallback — production MUST set a strong JWT_SECRET.
    return 'nexora-dev-jwt-secret-change-me';
  }
  return secret;
}

export function signAccessToken(userId: string, organizationId: string): string {
  return jwt.sign({ sub: userId, org: organizationId, typ: 'access' }, getJwtSecret(), {
    expiresIn: '15m',
  });
}

export function signRefreshToken(userId: string, organizationId: string, rememberMe = false): string {
  return jwt.sign({ sub: userId, org: organizationId, typ: 'refresh' }, getJwtSecret(), {
    expiresIn: rememberMe ? '30d' : '7d',
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}

async function loadActingUser(userId: string): Promise<ActingUser | null> {
  const result = await query<{
    id: string;
    email: string;
    display_name: string | null;
    role: ActingUser['role'];
    organization_id: string;
    is_verified: boolean;
    is_suspended: boolean;
  }>(
    `select id, email, display_name, role, organization_id, is_verified, is_suspended
     from users where id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    organizationId: row.organization_id,
    role: row.role,
    isVerified: row.is_verified,
    isSuspended: row.is_suspended,
    permissions: [{ tool: 'slack', resourceType: 'channel', resourceId: '*', accessLevel: 'write' },
      { tool: 'notion', resourceType: 'page', resourceId: '*', accessLevel: 'write' },
      { tool: 'jira', resourceType: 'project', resourceId: '*', accessLevel: 'write' },
      { tool: 'gmail', resourceType: 'mailbox', resourceId: '*', accessLevel: 'write' },
      { tool: 'salesforce', resourceType: 'object', resourceId: '*', accessLevel: 'write' }],
  };
}

/** Optional auth — attaches user when token present, never 401s. */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      next();
      return;
    }
    const payload = verifyToken(token);
    if (payload.typ && payload.typ !== 'access') {
      next();
      return;
    }
    const user = await loadActingUser(payload.sub);
    if (user && !user.isSuspended) req.user = user;
  } catch {
    // ignore invalid token for optional auth
  }
  next();
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'missing_token' });
      return;
    }
    const payload = verifyToken(token);
    if (payload.typ && payload.typ !== 'access') {
      res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'invalid_token_type' });
      return;
    }
    const user = await loadActingUser(payload.sub);
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'user_not_found' });
      return;
    }
    if (user.isSuspended) {
      res.status(403).json({ success: false, message: 'Account suspended', data: null, error: 'suspended' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'invalid_token' });
  }
}

export function requireVerified(req: Request, res: Response, next: NextFunction): void {
  // Investor / pre-SaaS demo: don't block chat on email verification
  if ((process.env.SAAS_MODE ?? 'true') !== 'true') {
    next();
    return;
  }
  if (!req.user?.isVerified && req.user?.role !== 'super_admin') {
    res.status(403).json({
      success: false,
      message: 'Please verify your email before using Nexora OS',
      data: null,
      error: 'email_unverified',
    });
    return;
  }
  next();
}

export function requireRole(...roles: ActingUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'unauthorized' });
      return;
    }
    if (req.user.role === 'super_admin') {
      next();
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Forbidden — insufficient role.', data: null, error: 'forbidden' });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'unauthorized' });
    return;
  }
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin' && req.user.role !== 'owner') {
    res.status(403).json({ success: false, message: 'Admin access required', data: null, error: 'forbidden' });
    return;
  }
  next();
}

/** @deprecated demo helper — returns empty in SaaS mode */
export function getDemoOrgId(): string {
  return process.env.DEMO_ORG_ID ?? 'org-demo';
}
