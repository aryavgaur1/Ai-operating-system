import { Router } from 'express';
import { asyncHandler, ok, AppError } from '../lib/errors';
import { issueSession } from '../lib/authTokens';
import {
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  wrapInvitationMembershipError,
} from '../lib/invitationService';
import {
  createTeamWorkspace,
  listWorkspacesForUser,
  membershipErrorToAppError,
  resolveWorkspaceContext,
  selectActiveWorkspace,
} from '../lib/workspaceService';
import { MembershipAuthorizationError } from '../lib/workspaceAuth';

export const workspacesRouter = Router();

function wrapMembership<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => membershipErrorToAppError(err));
}

/** GET /workspaces — active memberships only */
workspacesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const workspaces = await wrapMembership(() => listWorkspacesForUser(req.user!.id));
    ok(res, { workspaces });
  })
);

/** GET /workspaces/current — membership-validated active context */
workspacesRouter.get(
  '/current',
  asyncHandler(async (req, res) => {
    const workspace = await wrapMembership(() => resolveWorkspaceContext(req.user!.id));
    ok(res, { workspace });
  })
);

/**
 * POST /workspaces — create a TEAM organization.
 * Creator becomes owner. Personal home org is never replaced.
 */
workspacesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = req.body?.name ?? req.body?.workspaceName;
    try {
      const workspace = await createTeamWorkspace({
        userId: req.user!.id,
        name: String(name ?? ''),
      });
      ok(res, { workspace }, 'Team workspace created', 201);
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) membershipErrorToAppError(err);
      throw err;
    }
  })
);

/**
 * POST /workspaces/:organizationId/activate — set active org after membership check.
 * Re-issues session tokens bound to the selected org (JWT org claim).
 * Does not create conversations or mutate chat history.
 */
workspacesRouter.post(
  '/:organizationId/activate',
  asyncHandler(async (req, res) => {
    let workspace;
    try {
      workspace = await selectActiveWorkspace({
        userId: req.user!.id,
        organizationId: req.params.organizationId,
      });
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) membershipErrorToAppError(err);
      throw err;
    }

    const ip = (req.header('x-forwarded-for') ?? req.socket.remoteAddress ?? '').toString();
    const session = await issueSession(res, req.user!.id, workspace.organizationId, {
      userAgent: req.header('user-agent'),
      ip,
    });

    ok(res, {
      workspace,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      token: session.accessToken,
    }, 'Active workspace updated');
  })
);

/** Reject accidental collection-level activate without id */
workspacesRouter.post(
  '/activate',
  asyncHandler(async () => {
    throw new AppError('organizationId is required', 422);
  })
);

/**
 * POST /workspaces/:organizationId/invitations
 * Owner/admin of a TEAM org only. Returns invitation + email delivery status.
 * rawToken is returned once for callers that need the accept link when email
 * was not delivered (e.g. console fallback in local dev).
 */
workspacesRouter.post(
  '/:organizationId/invitations',
  asyncHandler(async (req, res) => {
    try {
      const result = await createInvitation({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
        email: String(req.body?.email ?? ''),
        role: req.body?.role,
      });
      ok(
        res,
        {
          invitation: result.invitation,
          email: result.email,
          // Only surface raw token when email was not delivered so accept still works locally.
          ...(result.email.delivered ? {} : { acceptToken: result.rawToken }),
        },
        result.email.delivered
          ? 'Invitation created and email delivered'
          : 'Invitation created; email not delivered',
        201
      );
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) wrapInvitationMembershipError(err);
      throw err;
    }
  })
);

/** GET /workspaces/:organizationId/invitations — owner/admin list */
workspacesRouter.get(
  '/:organizationId/invitations',
  asyncHandler(async (req, res) => {
    try {
      const invitations = await listInvitations({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
      });
      ok(res, { invitations });
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) wrapInvitationMembershipError(err);
      throw err;
    }
  })
);

/** POST /workspaces/:organizationId/invitations/:invitationId/revoke */
workspacesRouter.post(
  '/:organizationId/invitations/:invitationId/revoke',
  asyncHandler(async (req, res) => {
    try {
      const invitation = await revokeInvitation({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
        invitationId: req.params.invitationId,
      });
      ok(res, { invitation }, 'Invitation revoked');
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) wrapInvitationMembershipError(err);
      throw err;
    }
  })
);

/**
 * POST /workspaces/:organizationId/invitations/:invitationId/resend
 * Revokes prior pending token(s) for same email and issues a new one.
 */
workspacesRouter.post(
  '/:organizationId/invitations/:invitationId/resend',
  asyncHandler(async (req, res) => {
    try {
      const result = await resendInvitation({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
        invitationId: req.params.invitationId,
      });
      ok(
        res,
        {
          invitation: result.invitation,
          email: result.email,
          ...(result.email.delivered ? {} : { acceptToken: result.rawToken }),
        },
        result.email.delivered
          ? 'Invitation resent and email delivered'
          : 'Invitation resent; email not delivered'
      );
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) wrapInvitationMembershipError(err);
      throw err;
    }
  })
);
