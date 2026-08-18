import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ActingUser } from '@enterprise-ai-os/shared';
import { query } from '@enterprise-ai-os/stores';
import { isPlatformAdminEmail } from '../lib/platformAdmin';
import {
  MembershipAuthorizationError,
  resolveAuthorizedOrganization,
} from '../lib/workspaceAuth';

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
  org?: string;
  typ?: string;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'replace-with-a-long-random-string') {
    // Dev fallback — production MUST set a strong JWT_SECRET.
    return 'nexora-dev-jwt-secret-change-me';
  }
  return secret;
}

export function signAccessToken(userId: string, organizationId: string): string {
  // SPA on Netlify calling Railway — short tokens caused mass Unauthorized when
  // cross-site refresh cookies failed. Keep sessions usable for a work day.
  return jwt.sign({ sub: userId, org: organizationId, typ: 'access' }, getJwtSecret(), {
    expiresIn: '12h',
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

const DEFAULT_PERMISSIONS: ActingUser['permissions'] = [
  { tool: 'slack', resourceType: 'channel', resourceId: '*', accessLevel: 'write' },
  { tool: 'notion', resourceType: 'page', resourceId: '*', accessLevel: 'write' },
  { tool: 'jira', resourceType: 'project', resourceId: '*', accessLevel: 'write' },
  { tool: 'gmail', resourceType: 'mailbox', resourceId: '*', accessLevel: 'write' },
  { tool: 'salesforce', resourceType: 'object', resourceId: '*', accessLevel: 'write' },
];

/**
 * Load acting user with membership-authoritative organization + role.
 * JWT org is validated against organization_memberships (fail closed).
 * Legacy users.role = super_admin is preserved for platform gates only;
 * tenant access still requires an active membership for the org claim.
 */
export async function loadActingUser(
  userId: string,
  jwtOrganizationId?: string | null
): Promise<ActingUser | null> {
  const result = await query<{
    id: string;
    email: string;
    display_name: string | null;
    role: string;
    organization_id: string;
    active_organization_id: string | null;
    is_verified: boolean;
    is_suspended: boolean;
  }>(
    `select id, email, display_name, role, organization_id, active_organization_id,
            is_verified, is_suspended
     from users where id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;

  let authorized: { organizationId: string; membership: { role: ActingUser['role'] } };
  try {
    authorized = await resolveAuthorizedOrganization({
      userId: row.id,
      homeOrganizationId: row.organization_id,
      activeOrganizationId: row.active_organization_id,
      jwtOrganizationId,
    });
  } catch (err) {
    if (err instanceof MembershipAuthorizationError) {
      return null;
    }
    throw err;
  }

  // Preserve platform super_admin for existing gates; tenant org still membership-bound.
  const role: ActingUser['role'] =
    row.role === 'super_admin' ? 'super_admin' : (authorized.membership.role as ActingUser['role']);

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    organizationId: authorized.organizationId,
    role,
    isVerified: row.is_verified,
    isSuspended: row.is_suspended,
    permissions: DEFAULT_PERMISSIONS,
  };
}

function membershipFailResponse(res: Response, err: MembershipAuthorizationError): void {
  const status = err.code === 'organization_not_found' ? 404 : 403;
  res.status(status).json({
    success: false,
    message: err.message,
    data: null,
    error: err.code,
  });
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
    const user = await loadActingUser(payload.sub, payload.org);
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

    // Explicit membership resolution so clients get fail-closed error codes.
    const base = await query<{
      id: string;
      organization_id: string;
      active_organization_id: string | null;
      is_suspended: boolean;
    }>(
      `select id, organization_id, active_organization_id, is_suspended from users where id = $1`,
      [payload.sub]
    );
    const row = base.rows[0];
    if (!row) {
      res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'user_not_found' });
      return;
    }
    if (row.is_suspended) {
      res.status(403).json({ success: false, message: 'Account suspended', data: null, error: 'suspended' });
      return;
    }

    try {
      await resolveAuthorizedOrganization({
        userId: row.id,
        homeOrganizationId: row.organization_id,
        activeOrganizationId: row.active_organization_id,
        jwtOrganizationId: payload.org,
      });
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) {
        membershipFailResponse(res, err);
        return;
      }
      throw err;
    }

    const user = await loadActingUser(payload.sub, payload.org);
    if (!user) {
      res.status(403).json({
        success: false,
        message: 'Active organization membership required.',
        data: null,
        error: 'membership_required',
      });
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

/**
 * Workspace role gate — uses membership-resolved ActingUser.role.
 * Platform email admin is separate (requireAdmin); do not use it for tenant roles.
 */
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
      res.status(403).json({
        success: false,
        message: 'Forbidden — insufficient role.',
        data: null,
        error: 'forbidden',
      });
      return;
    }
    next();
  };
}

/** Owner/admin-only workspace operations (membership roles). */
export function requireWorkspaceAdmin(req: Request, res: Response, next: NextFunction): void {
  return requireRole('owner', 'admin')(req, res, next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Unauthorized', data: null, error: 'unauthorized' });
    return;
  }
  // Platform admin is email-gated (founder only), not tenant org admin role.
  if (!isPlatformAdminEmail(req.user.email)) {
    res.status(403).json({ success: false, message: 'Admin access required', data: null, error: 'forbidden' });
    return;
  }
  next();
}

/** @deprecated demo helper — returns empty in SaaS mode */
export function getDemoOrgId(): string {
  return process.env.DEMO_ORG_ID ?? 'org-demo';
}
