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
  listWorkspaceMembers,
  listWorkspacesForUser,
  membershipErrorToAppError,
  removeMember,
  renameWorkspace,
  resolveWorkspaceContext,
  selectActiveWorkspace,
  updateMemberRole,
} from '../lib/workspaceService';
import { MembershipAuthorizationError } from '../lib/workspaceAuth';

export const workspacesRouter = Router();

function invitationEmailError(email: {
  delivered: boolean;
  mode: string;
  errorCode?: string;
  hint?: string;
}): AppError {
  const detail =
    email.hint ||
    (email.errorCode
      ? `Gmail API delivery failed (${email.errorCode}).`
      : `Email delivery failed (${email.mode}).`);
  return new AppError(`Invitation could not be sent. ${detail}`, 502);
}

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
 * GET /workspaces/:organizationId/members
 * Any active member may list active members (real DB rows only).
 */
workspacesRouter.get(
  '/:organizationId/members',
  asyncHandler(async (req, res) => {
    try {
      const members = await listWorkspaceMembers({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
      });
      ok(res, { members });
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) membershipErrorToAppError(err);
      throw err;
    }
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
      if (!result.email.delivered) {
        throw invitationEmailError(result.email);
      }
      ok(
        res,
        {
          invitation: result.invitation,
          email: result.email,
        },
        'Invitation created and email delivered',
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

/**
 * PATCH /workspaces/:organizationId — rename a team workspace (owner/admin only).
 * Personal workspace is blocked server-side.
 */
workspacesRouter.patch(
  '/:organizationId',
  asyncHandler(async (req, res) => {
    try {
      const workspace = await renameWorkspace({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
        name: String(req.body?.name ?? ''),
      });
      ok(res, { workspace }, 'Workspace renamed');
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) membershipErrorToAppError(err);
      throw err;
    }
  })
);

/**
 * PATCH /workspaces/:organizationId/members/:userId — change role (owner only).
 */
workspacesRouter.patch(
  '/:organizationId/members/:userId',
  asyncHandler(async (req, res) => {
    try {
      const result = await updateMemberRole({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
        targetUserId: req.params.userId,
        role: String(req.body?.role ?? ''),
      });
      ok(res, result, 'Member role updated');
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) membershipErrorToAppError(err);
      throw err;
    }
  })
);

/**
 * DELETE /workspaces/:organizationId/members/:userId — remove a member (owner/admin).
 */
workspacesRouter.delete(
  '/:organizationId/members/:userId',
  asyncHandler(async (req, res) => {
    try {
      await removeMember({
        actorUserId: req.user!.id,
        organizationId: req.params.organizationId,
        targetUserId: req.params.userId,
      });
      ok(res, {}, 'Member removed');
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) membershipErrorToAppError(err);
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
      if (!result.email.delivered) {
        throw invitationEmailError(result.email);
      }
      ok(
        res,
        {
          invitation: result.invitation,
          email: result.email,
        },
        'Invitation resent and email delivered'
      );
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) wrapInvitationMembershipError(err);
      throw err;
    }
  })
);
