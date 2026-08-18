/**
 * P0.5 B4 — Token-scoped invitation preview (public) + accept (authenticated).
 */
import { Router } from 'express';
import { asyncHandler, ok } from '../lib/errors';
import { acceptInvitation, previewInvitation, wrapInvitationMembershipError } from '../lib/invitationService';
import { MembershipAuthorizationError } from '../lib/workspaceAuth';

/** Public preview — no auth. Never returns token_hash. */
export const invitationsPublicRouter = Router();

invitationsPublicRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const preview = await previewInvitation(req.params.token);
    ok(res, { invitation: preview });
  })
);

/** Authenticated accept — mounted after authenticate middleware. */
export const invitationsAuthRouter = Router();

invitationsAuthRouter.post(
  '/:token/accept',
  asyncHandler(async (req, res) => {
    try {
      const result = await acceptInvitation({
        actorUserId: req.user!.id,
        rawToken: req.params.token,
      });
      ok(res, {
        invitation: result.invitation,
        membership: result.membership,
        alreadyMember: result.alreadyMember,
      }, result.alreadyMember ? 'Already a member; invitation marked accepted' : 'Invitation accepted');
    } catch (err) {
      if (err instanceof MembershipAuthorizationError) wrapInvitationMembershipError(err);
      throw err;
    }
  })
);
