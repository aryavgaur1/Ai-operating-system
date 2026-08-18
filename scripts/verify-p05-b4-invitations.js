#!/usr/bin/env node
/**
 * P0.5 B4 — Team invitation lifecycle verification (local DB + dist services).
 *
 * Usage: node scripts/verify-p05-b4-invitations.js
 * Requires: DATABASE_URL and built apps/api dist.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function expectThrow(fn, statusOrIncludes, label) {
  try {
    await fn();
    throw new Error(`${label}: expected throw`);
  } catch (err) {
    if (err.message === `${label}: expected throw`) throw err;
    if (typeof statusOrIncludes === 'number') {
      assert(err.statusCode === statusOrIncludes, `${label}: expected status ${statusOrIncludes}, got ${err.statusCode}: ${err.message}`);
    } else {
      assert(String(err.message).includes(statusOrIncludes), `${label}: expected message to include "${statusOrIncludes}", got: ${err.message}`);
    }
  }
}

async function main() {
  assert(process.env.DATABASE_URL, 'DATABASE_URL required');

  let invitationService;
  let workspaceService;
  let AppError;
  try {
    invitationService = require('../apps/api/dist/lib/invitationService.js');
    workspaceService = require('../apps/api/dist/lib/workspaceService.js');
    AppError = require('../apps/api/dist/lib/errors.js').AppError;
  } catch (err) {
    console.error('FAIL load dist:', err.message);
    console.error('Run: npm run build -w packages/shared && npm run build -w packages/stores && npm run build -w apps/api');
    process.exit(1);
  }

  const {
    createInvitation,
    acceptInvitation,
    revokeInvitation,
    resendInvitation,
    hashInvitationToken,
  } = invitationService;
  const { createTeamWorkspace } = workspaceService;

  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const suffix = Date.now().toString(36);
  const ownerEmail = `b4.owner.${suffix}@example.com`;
  const adminEmail = `b4.admin.${suffix}@example.com`;
  const memberEmail = `b4.member.${suffix}@example.com`;
  const inviteeEmail = `b4.invitee.${suffix}@example.com`;
  const wrongEmail = `b4.wrong.${suffix}@example.com`;
  const foreignOwnerEmail = `b4.foreign.${suffix}@example.com`;

  let ownerId;
  let adminId;
  let memberId;
  let inviteeId;
  let wrongUserId;
  let foreignOwnerId;
  let personalOrgId;
  let teamOrgId;
  let foreignTeamId;
  let snapshot;

  try {
    // --- seed owner + personal ---
    const personal = await client.query(
      `insert into organizations (name, slug, kind) values ($1,$2,'personal') returning id`,
      [`B4 Personal ${suffix}`, `b4-personal-${suffix}`]
    );
    personalOrgId = personal.rows[0].id;

    const owner = await client.query(
      `insert into users (organization_id, active_organization_id, email, display_name, role, password_hash, is_verified)
       values ($1,$1,$2,'B4 Owner','owner','x',true) returning id`,
      [personalOrgId, ownerEmail]
    );
    ownerId = owner.rows[0].id;
    await client.query(
      `insert into organization_memberships (organization_id, user_id, role, status) values ($1,$2,'owner','active')`,
      [personalOrgId, ownerId]
    );
    await client.query(
      `insert into user_workspace_state (user_id, organization_id) values ($1,$2) on conflict do nothing`,
      [ownerId, personalOrgId]
    );

    const team = await createTeamWorkspace({ userId: ownerId, name: `B4 Team ${suffix}` });
    teamOrgId = team.id;

    // admin + member users (personal homes) then add to team
    async function seedUser(email, name) {
      const org = await client.query(
        `insert into organizations (name, slug, kind) values ($1,$2,'personal') returning id`,
        [`${name} Home ${suffix}`, `b4-${name.toLowerCase()}-${suffix}`]
      );
      const orgId = org.rows[0].id;
      const u = await client.query(
        `insert into users (organization_id, active_organization_id, email, display_name, role, password_hash, is_verified)
         values ($1,$1,$2,$3,'owner','x',true) returning id`,
        [orgId, email, name]
      );
      const id = u.rows[0].id;
      await client.query(
        `insert into organization_memberships (organization_id, user_id, role, status) values ($1,$2,'owner','active')`,
        [orgId, id]
      );
      await client.query(
        `insert into user_workspace_state (user_id, organization_id) values ($1,$2) on conflict do nothing`,
        [id, orgId]
      );
      return { id, orgId };
    }

    const adminSeed = await seedUser(adminEmail, 'B4Admin');
    adminId = adminSeed.id;
    await client.query(
      `insert into organization_memberships (organization_id, user_id, role, status) values ($1,$2,'admin','active')`,
      [teamOrgId, adminId]
    );

    const memberSeed = await seedUser(memberEmail, 'B4Member');
    memberId = memberSeed.id;
    await client.query(
      `insert into organization_memberships (organization_id, user_id, role, status) values ($1,$2,'member','active')`,
      [teamOrgId, memberId]
    );

    const inviteeSeed = await seedUser(inviteeEmail, 'B4Invitee');
    inviteeId = inviteeSeed.id;

    const wrongSeed = await seedUser(wrongEmail, 'B4Wrong');
    wrongUserId = wrongSeed.id;

    const foreign = await seedUser(foreignOwnerEmail, 'B4Foreign');
    foreignOwnerId = foreign.id;
    const foreignTeam = await createTeamWorkspace({ userId: foreignOwnerId, name: `B4 Foreign ${suffix}` });
    foreignTeamId = foreignTeam.id;

    // Seed a conversation on personal to prove no chat mutation
    const conv = await client.query(
      `insert into conversations (organization_id, user_id, title) values ($1,$2,'B4 personal chat') returning id`,
      [personalOrgId, ownerId]
    );
    const convId = conv.rows[0].id;
    await client.query(
      `insert into messages (conversation_id, role, content) values ($1,'user','hello b4')`,
      [convId]
    );

    async function takeSnapshot() {
      const users = await client.query(
        `select organization_id, active_organization_id from users where id = $1`,
        [ownerId]
      );
      const convs = await client.query(`select count(*)::int as c, max(id::text) as mid from conversations where user_id=$1`, [
        ownerId,
      ]);
      const msgs = await client.query(
        `select count(*)::int as c from messages m join conversations c on c.id=m.conversation_id where c.user_id=$1`,
        [ownerId]
      );
      let approvals = { rows: [{ c: 0 }] };
      try {
        approvals = await client.query(
          `select count(*)::int as c from approvals a
           join conversations c on c.id = a.conversation_id where c.user_id=$1`,
          [ownerId]
        );
      } catch {
        try {
          approvals = await client.query(`select count(*)::int as c from approvals where organization_id=$1`, [
            personalOrgId,
          ]);
        } catch {
          /* optional */
        }
      }
      let integrations = { rows: [{ c: 0 }] };
      try {
        integrations = await client.query(
          `select count(*)::int as c from tool_connections where organization_id=$1`,
          [personalOrgId]
        );
      } catch {
        try {
          integrations = await client.query(
            `select count(*)::int as c from oauth_connections where organization_id=$1`,
            [personalOrgId]
          );
        } catch {
          /* optional */
        }
      }
      return {
        organizationId: users.rows[0].organization_id,
        activeOrganizationId: users.rows[0].active_organization_id,
        conversations: convs.rows[0].c,
        messages: msgs.rows[0].c,
        approvals: approvals.rows[0].c,
        integrations: integrations.rows[0].c,
      };
    }

    snapshot = await takeSnapshot();

    // 1. Owner can invite
    let invite1 = await createInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      email: inviteeEmail,
      role: 'member',
    });
    assert(invite1.invitation.status === 'pending', 'owner invite pending');
    assert(invite1.rawToken && invite1.rawToken.length >= 32, 'raw token present once');
    assert(invite1.email && typeof invite1.email.delivered === 'boolean', 'email delivery status present');
    console.log('PASS 1 owner can invite');

    // 7. Token not stored plaintext
    const stored = await client.query(
      `select token_hash, email, role, status from organization_invitations where id=$1`,
      [invite1.invitation.id]
    );
    assert(stored.rows[0].token_hash !== invite1.rawToken, 'token not plaintext');
    assert(stored.rows[0].token_hash === hashInvitationToken(invite1.rawToken), 'token hashed sha256');
    assert(!String(JSON.stringify(stored.rows[0])).includes(invite1.rawToken), 'raw token absent from row');
    console.log('PASS 7 token not stored plaintext');

    // 2. Admin can invite
    const adminInvitee = `b4.admininvite.${suffix}@example.com`;
    const inviteAdmin = await createInvitation({
      actorUserId: adminId,
      organizationId: teamOrgId,
      email: adminInvitee,
      role: 'admin',
    });
    assert(inviteAdmin.invitation.role === 'admin', 'admin invited as admin');
    console.log('PASS 2 admin can invite');

    // 3. Member cannot invite
    await expectThrow(
      () =>
        createInvitation({
          actorUserId: memberId,
          organizationId: teamOrgId,
          email: `b4.nomember.${suffix}@example.com`,
          role: 'member',
        }),
      403,
      'member invite'
    );
    console.log('PASS 3 member cannot invite');

    // 4. Personal workspace cannot send invitations
    await expectThrow(
      () =>
        createInvitation({
          actorUserId: ownerId,
          organizationId: personalOrgId,
          email: `b4.personal.${suffix}@example.com`,
          role: 'member',
        }),
      403,
      'personal invite'
    );
    console.log('PASS 4 personal workspace cannot invite');

    // 5. Invalid email rejected
    await expectThrow(
      () =>
        createInvitation({
          actorUserId: ownerId,
          organizationId: teamOrgId,
          email: 'not-an-email',
          role: 'member',
        }),
      422,
      'invalid email'
    );
    console.log('PASS 5 invalid email rejected');

    // 6. Owner role cannot be assigned through invitation
    await expectThrow(
      () =>
        createInvitation({
          actorUserId: ownerId,
          organizationId: teamOrgId,
          email: `b4.ownerrole.${suffix}@example.com`,
          role: 'owner',
        }),
      422,
      'owner role invite'
    );
    console.log('PASS 6 owner role cannot be invited');

    // 15. Existing member cannot receive redundant invitation
    await expectThrow(
      () =>
        createInvitation({
          actorUserId: ownerId,
          organizationId: teamOrgId,
          email: memberEmail,
          role: 'member',
        }),
      409,
      'existing member invite'
    );
    console.log('PASS 15 existing member cannot receive invitation');

    // Duplicate pending → resend (fresh token + re-email), not a hard 409
    const dup = await createInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      email: inviteeEmail,
      role: 'member',
    });
    assert(dup.invitation.status === 'pending', 'duplicate pending becomes resent pending');
    assert(dup.rawToken && dup.rawToken !== invite1.rawToken, 'resend issues a new raw token');
    invite1 = dup;
    console.log('PASS 14b duplicate pending auto-resends');

    // 9. Wrong authenticated email cannot accept
    await expectThrow(
      () => acceptInvitation({ actorUserId: wrongUserId, rawToken: invite1.rawToken }),
      403,
      'wrong email accept'
    );
    console.log('PASS 9 wrong email cannot accept');

    // 10. Correct email can accept
    const accepted = await acceptInvitation({ actorUserId: inviteeId, rawToken: invite1.rawToken });
    assert(accepted.invitation.status === 'accepted', 'accepted status');
    assert(accepted.invitation.acceptedByUserId === inviteeId, 'accepted_by set');
    assert(accepted.membership.status === 'active', 'membership active');
    assert(accepted.membership.organizationId === teamOrgId, 'membership org');
    const mem = await client.query(
      `select role, status from organization_memberships where organization_id=$1 and user_id=$2`,
      [teamOrgId, inviteeId]
    );
    assert(mem.rows[0]?.status === 'active' && mem.rows[0]?.role === 'member', 'db membership');
    console.log('PASS 10 correct email can accept');

    // 11. Accepted invitation cannot be reused
    await expectThrow(
      () => acceptInvitation({ actorUserId: inviteeId, rawToken: invite1.rawToken }),
      409,
      'reuse accepted'
    );
    console.log('PASS 11 accepted invitation cannot be reused');

    // 14. Duplicate active membership prevented
    const memCount = await client.query(
      `select count(*)::int as c from organization_memberships where organization_id=$1 and user_id=$2`,
      [teamOrgId, inviteeId]
    );
    assert(memCount.rows[0].c === 1, 'single membership row');
    console.log('PASS 14 duplicate active membership prevented');

    // 16. Owner can revoke
    const revokeTarget = await createInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      email: `b4.revoke.${suffix}@example.com`,
      role: 'member',
    });
    const revoked = await revokeInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      invitationId: revokeTarget.invitation.id,
    });
    assert(revoked.status === 'revoked', 'revoked');
    console.log('PASS 16 owner can revoke');

    // Admin can revoke (also under 16)
    const revokeAdminTarget = await createInvitation({
      actorUserId: adminId,
      organizationId: teamOrgId,
      email: `b4.revokeadmin.${suffix}@example.com`,
      role: 'member',
    });
    const revokedByAdmin = await revokeInvitation({
      actorUserId: adminId,
      organizationId: teamOrgId,
      invitationId: revokeAdminTarget.invitation.id,
    });
    assert(revokedByAdmin.status === 'revoked', 'admin revoke');

    // 12. Revoked invitation cannot be accepted
    // Need a user matching email for accept attempt
    const revokedEmail = `b4.revokeduser.${suffix}@example.com`;
    const revokedInvite = await createInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      email: revokedEmail,
      role: 'member',
    });
    await revokeInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      invitationId: revokedInvite.invitation.id,
    });
    const revokedUser = await seedUser(revokedEmail, 'B4Revoked');
    await expectThrow(
      () => acceptInvitation({ actorUserId: revokedUser.id, rawToken: revokedInvite.rawToken }),
      409,
      'revoked accept'
    );
    console.log('PASS 12 revoked invitation cannot be accepted');

    // 17. Member cannot revoke
    const memberRevokeTarget = await createInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      email: `b4.memberrevoke.${suffix}@example.com`,
      role: 'member',
    });
    await expectThrow(
      () =>
        revokeInvitation({
          actorUserId: memberId,
          organizationId: teamOrgId,
          invitationId: memberRevokeTarget.invitation.id,
        }),
      403,
      'member revoke'
    );
    console.log('PASS 17 member cannot revoke');

    // 18. Cross-organization revoke fails
    await expectThrow(
      () =>
        revokeInvitation({
          actorUserId: foreignOwnerId,
          organizationId: foreignTeamId,
          invitationId: memberRevokeTarget.invitation.id,
        }),
      403,
      'cross-org revoke'
    );
    // Also: owner of team A cannot revoke using foreign org path even if they somehow know id
    await expectThrow(
      () =>
        revokeInvitation({
          actorUserId: ownerId,
          organizationId: foreignTeamId,
          invitationId: memberRevokeTarget.invitation.id,
        }),
      403,
      'cross-org revoke path'
    );
    console.log('PASS 18 cross-organization revoke fails');

    // 19–21. Resend invalidates previous token; new token works
    const resendEmail = `b4.resend.${suffix}@example.com`;
    const resendUser = await seedUser(resendEmail, 'B4Resend');
    const beforeResend = await createInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      email: resendEmail,
      role: 'member',
    });
    const oldToken = beforeResend.rawToken;
    const resent = await resendInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      invitationId: beforeResend.invitation.id,
    });
    assert(resent.rawToken !== oldToken, 'new token different');
    const oldRow = await client.query(`select status from organization_invitations where id=$1`, [
      beforeResend.invitation.id,
    ]);
    assert(oldRow.rows[0].status === 'revoked', 'old invitation revoked');
    console.log('PASS 19 resend invalidates previous token');

    await expectThrow(
      () => acceptInvitation({ actorUserId: resendUser.id, rawToken: oldToken }),
      409,
      'old token after resend'
    );
    console.log('PASS 20 previous token cannot be reused after resend');

    const acceptResend = await acceptInvitation({
      actorUserId: resendUser.id,
      rawToken: resent.rawToken,
    });
    assert(acceptResend.invitation.status === 'accepted', 'new token accepted');
    console.log('PASS 21 new token can be accepted');

    // 8 + 13. Expiration
    const expireEmail = `b4.expire.${suffix}@example.com`;
    const expireUser = await seedUser(expireEmail, 'B4Expire');
    const expireInvite = await createInvitation({
      actorUserId: ownerId,
      organizationId: teamOrgId,
      email: expireEmail,
      role: 'member',
    });
    await client.query(
      `update organization_invitations set expires_at = now() - interval '1 minute' where id=$1`,
      [expireInvite.invitation.id]
    );
    await expectThrow(
      () => acceptInvitation({ actorUserId: expireUser.id, rawToken: expireInvite.rawToken }),
      409,
      'expired accept'
    );
    const expiredRow = await client.query(`select status from organization_invitations where id=$1`, [
      expireInvite.invitation.id,
    ]);
    assert(expiredRow.rows[0].status === 'expired', 'marked expired');
    console.log('PASS 8 invitation expires correctly');
    console.log('PASS 13 expired invitation cannot be accepted');

    // 22–23. Personal workspace + chat/approval/integration unchanged
    const after = await takeSnapshot();
    assert(after.organizationId === snapshot.organizationId, 'personal org unchanged');
    assert(after.organizationId === personalOrgId, 'still personal home');
    assert(after.conversations === snapshot.conversations, 'conversations unchanged');
    assert(after.messages === snapshot.messages, 'messages unchanged');
    assert(after.approvals === snapshot.approvals, 'approvals unchanged');
    assert(after.integrations === snapshot.integrations, 'integrations unchanged');
    console.log('PASS 22 existing personal workspace remains unchanged');
    console.log('PASS 23 no conversation/message/approval/integration data changes');

    // Confirm no seat-limit rejection path exists (B5 not implemented)
    assert(
      !String(createInvitation.toString()).includes('MAX_ACTIVE_MEMBERS') &&
        !String(acceptInvitation.toString()).includes('MAX_ACTIVE_MEMBERS'),
      'B5 seat limit must not be present'
    );
    console.log('PASS (gate) B5 seat enforcement not implemented');

    console.log('\nB4 invitation verification: ALL PASS');
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
