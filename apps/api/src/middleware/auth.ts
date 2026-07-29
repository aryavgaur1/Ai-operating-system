import type { NextFunction, Request, Response } from 'express';
import type { ActingUser } from '@enterprise-ai-os/shared';

// ============================================================
// RBAC middleware — every downstream handler receives req.user
// with that user's permitted resources per tool, mirrored from
// the native tool's own permission model (Slack channel
// membership, Jira project role, etc). The agent must never
// surface or act on data the user couldn't already reach
// themselves in the source tool — this is enforced here, once,
// rather than re-implemented per route.
//
// This demo trusts x-org-id / x-user-id headers directly instead
// of verifying a real session/JWT. Swap the body of `authenticate`
// for real session verification (see the commented JWT sketch
// below) before deploying anywhere but localhost.
// ============================================================

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: ActingUser;
    }
  }
}

const DEMO_ORG_ID = 'org-demo';

const DEMO_USERS: Record<string, ActingUser> = {
  'user-meera': {
    id: 'user-meera',
    organizationId: DEMO_ORG_ID,
    email: 'meera@ourcompany.example',
    role: 'admin',
    permissions: [
      { tool: 'slack', resourceType: 'channel', resourceId: 'project-phoenix', accessLevel: 'write' },
      { tool: 'slack', resourceType: 'channel', resourceId: 'client-acme-corp', accessLevel: 'write' },
      { tool: 'jira', resourceType: 'project', resourceId: 'PHX', accessLevel: 'write' },
      { tool: 'gmail', resourceType: 'mailbox', resourceId: 'meera@ourcompany.example', accessLevel: 'write' },
      { tool: 'salesforce', resourceType: 'object', resourceId: 'Opportunity', accessLevel: 'write' },
      { tool: 'notion', resourceType: 'page', resourceId: '*', accessLevel: 'write' },
    ],
  },
};

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.header('x-user-id') || 'user-meera').toString();
  const user = DEMO_USERS[userId] ?? DEMO_USERS['user-meera'];
  req.user = user;
  next();
}

export function requireRole(...roles: ActingUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden — insufficient role.' });
      return;
    }
    next();
  };
}

export function getDemoOrgId(): string {
  return DEMO_ORG_ID;
}

/*
// ---- Real session/JWT verification (sketch) ----
// import jwt from 'jsonwebtoken';
// export function authenticate(req, res, next) {
//   const token = req.header('authorization')?.replace('Bearer ', '');
//   try {
//     const payload = jwt.verify(token!, process.env.JWT_SECRET!);
//     req.user = loadUserWithPermissionsFromPostgres(payload.sub); // hits users + tool_permissions tables
//     next();
//   } catch {
//     res.status(401).json({ error: 'Unauthorized' });
//   }
// }
*/
