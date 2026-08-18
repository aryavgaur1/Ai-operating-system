#!/usr/bin/env node
/**
 * P0.5 — Team conversation sharing + personal isolation (backend).
 *
 * Usage: node scripts/verify-p05-team-conversation-sharing.js
 * Requires: DATABASE_URL, migrations through 014, built apps/api dist.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(process.env.DATABASE_URL, 'DATABASE_URL required');

  let invitationService;
  let workspaceService;
  let conversationAccess;
  try {
    invitationService = require('../apps/api/dist/lib/invitationService.js');
    workspaceService = require('../apps/api/dist/lib/workspaceService.js');
    conversationAccess = require('../apps/api/dist/lib/conversationAccess.js');
  } catch (err) {
    console.error('FAIL load dist:', err.message);
    console.error('Run: npm run build -w apps/api');
    process.exit(1);
  }

  const { createInvitation, acceptInvitation } = invitationService;
  const { createTeamWorkspace, selectActiveWorkspace } = workspaceService;
  const { listAccessibleConversations, assertConversationAccess } = conversationAccess;

  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const suffix = Date.now().toString(36);

  async function seedUser(email, displayName) {
    const slug = `p05-${displayName.toLowerCase().replace(/\W+/g, '-')}-${suffix}`;
    const org = await client.query(
      `insert into organizations (name, slug, kind) values ($1, $2, 'personal') returning id`,
      [`${displayName} Personal`, slug]
    );
    const orgId = org.rows[0].id;
    const user = await client.query(
      `insert into users (email, display_name, organization_id, role, password_hash, is_verified, active_organization_id)
       values ($1, $2, $3, 'owner', 'x', true, $3) returning id`,
      [email.toLowerCase(), displayName, orgId]
    );
    const userId = user.rows[0].id;
    await client.query(
      `insert into organization_memberships (organization_id, user_id, role, status)
       values ($1, $2, 'owner', 'active') on conflict do nothing`,
      [orgId, userId]
    );
    await client.query(
      `insert into user_workspace_state (user_id, organization_id) values ($1, $2) on conflict do nothing`,
      [userId, orgId]
    );
    return { id: userId, organizationId: orgId, email: email.toLowerCase() };
  }

  try {
    const owner = await seedUser(`p05.share.owner.${suffix}@example.com`, 'Aditya');
    const invitee = await seedUser(`rfgaur01.${suffix}@example.com`, 'RFGaur');

    const personalConv = await client.query(
      `insert into conversations (organization_id, user_id, title)
       values ($1, $2, 'Personal private') returning id`,
      [owner.organizationId, owner.id]
    );
    const personalConvId = personalConv.rows[0].id;

    const team = await createTeamWorkspace({ userId: owner.id, name: `Acme Company ${suffix}` });
    const teamOrgId = team.id;
    assert(teamOrgId, 'team org created');

    const invite = await createInvitation({
      actorUserId: owner.id,
      organizationId: teamOrgId,
      email: invitee.email,
      role: 'member',
    });
    assert(invite.invitation?.id, 'invitation persisted');
    const rawToken = invite.rawToken;
    assert(rawToken, 'raw token for email link');

    const accepted = await acceptInvitation({
      actorUserId: invitee.id,
      rawToken,
    });
    assert(accepted.membership?.status === 'active', 'membership active');

    await selectActiveWorkspace({ userId: owner.id, organizationId: teamOrgId });
    await selectActiveWorkspace({ userId: invitee.id, organizationId: teamOrgId });

    const teamConv = await client.query(
      `insert into conversations (organization_id, user_id, title)
       values ($1, $2, 'Acme shared thread') returning id`,
      [teamOrgId, owner.id]
    );
    const teamConvId = teamConv.rows[0].id;
    await client.query(
      `insert into messages (conversation_id, role, content) values ($1, 'user', 'hello team')`,
      [teamConvId]
    );

    const inviteeList = await listAccessibleConversations({
      organizationId: teamOrgId,
      userId: invitee.id,
    });
    assert(
      inviteeList.some((c) => c.id === teamConvId),
      'invitee sees owner team conversation'
    );

    await assertConversationAccess({
      organizationId: teamOrgId,
      userId: invitee.id,
      conversationId: teamConvId,
    });
    console.log('PASS team conversation shared with active member');

    let denied = false;
    try {
      await assertConversationAccess({
        organizationId: owner.organizationId,
        userId: invitee.id,
        conversationId: personalConvId,
      });
    } catch {
      denied = true;
    }
    assert(denied, 'invitee denied personal conversation');
    console.log('PASS personal conversation isolated');

    const ownerPersonalList = await listAccessibleConversations({
      organizationId: owner.organizationId,
      userId: owner.id,
    });
    assert(!ownerPersonalList.some((c) => c.id === teamConvId), 'team conv not in personal list');
    assert(
      ownerPersonalList.some((c) => c.id === personalConvId),
      'owner still sees personal conv'
    );
    console.log('PASS personal list unchanged / isolated from team');

    const other = await createTeamWorkspace({ userId: owner.id, name: `OtherCo ${suffix}` });
    const otherId = other.id;
    let foreignDeny = false;
    try {
      await assertConversationAccess({
        organizationId: otherId,
        userId: invitee.id,
        conversationId: teamConvId,
      });
    } catch {
      foreignDeny = true;
    }
    assert(foreignDeny, 'foreign org denied');
    console.log('PASS foreign team conversation denied');

    console.log('\nP0.5 team conversation sharing: ALL PASS');
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
