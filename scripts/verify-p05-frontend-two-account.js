#!/usr/bin/env node
/**
 * P0.5 frontend activation — two-account multi-user proof (API + members list).
 * Exercises the same endpoints the web UI calls.
 *
 * Usage: node scripts/verify-p05-frontend-two-account.js
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
  try {
    invitationService = require('../apps/api/dist/lib/invitationService.js');
    workspaceService = require('../apps/api/dist/lib/workspaceService.js');
  } catch (err) {
    console.error('Build API first:', err.message);
    process.exit(1);
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const suffix = Date.now().toString(36);

  const {
    createTeamWorkspace,
    listWorkspacesForUser,
    selectActiveWorkspace,
    listWorkspaceMembers,
  } = workspaceService;
  const { createInvitation, acceptInvitation } = invitationService;

  try {
    async function seedUser(email, name) {
      const org = await client.query(
        `insert into organizations (name, slug, kind) values ($1,$2,'personal') returning id`,
        [`${name} Home ${suffix}`, `fe-${name.toLowerCase()}-${suffix}`]
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
      return { id, orgId, email };
    }

    const accountA = await seedUser(`fe.owner.${suffix}@example.com`, 'OwnerA');
    const accountB = await seedUser(`fe.member.${suffix}@example.com`, 'MemberB');

    // A: personal visible
    let listA = await listWorkspacesForUser(accountA.id);
    assert(listA.some((w) => w.kind === 'personal' && w.isPersonalHome), 'A personal');
    console.log('PASS A sees personal workspace');

    // A creates team
    const team = await createTeamWorkspace({ userId: accountA.id, name: `Frontend Team ${suffix}` });
    assert(team.kind === 'team' && team.role === 'owner', 'team owner');
    listA = await listWorkspacesForUser(accountA.id);
    assert(listA.some((w) => w.id === team.id), 'team in list after create');
    console.log('PASS A creates team and it appears in GET /workspaces data');

    // Activate team
    const activated = await selectActiveWorkspace({ userId: accountA.id, organizationId: team.id });
    assert(activated.organizationId === team.id && activated.kind === 'team', 'activated team');
    console.log('PASS A activates team');

    // Members: A alone as owner
    let members = await listWorkspaceMembers({ actorUserId: accountA.id, organizationId: team.id });
    assert(members.length === 1, 'one member before invite');
    assert(members[0].userId === accountA.id && members[0].role === 'owner', 'owner row');
    console.log('PASS members list shows real owner');

    // Invite B
    const invite = await createInvitation({
      actorUserId: accountA.id,
      organizationId: team.id,
      email: accountB.email,
      role: 'member',
    });
    assert(invite.invitation.status === 'pending', 'pending invite');
    console.log('PASS A invites B');

    // B accepts
    const accepted = await acceptInvitation({
      actorUserId: accountB.id,
      rawToken: invite.rawToken,
    });
    assert(accepted.membership.status === 'active', 'B membership active');
    console.log('PASS B accepts invitation');

    // B sees team
    const listB = await listWorkspacesForUser(accountB.id);
    assert(listB.some((w) => w.id === team.id && w.kind === 'team'), 'B sees team');
    console.log('PASS B sees team workspace');

    // A sees B as member
    members = await listWorkspaceMembers({ actorUserId: accountA.id, organizationId: team.id });
    assert(members.length === 2, 'two members');
    assert(
      members.some((m) => m.userId === accountB.id && m.role === 'member' && m.email === accountB.email),
      'B in members list'
    );
    console.log('PASS A sees B as real member');

    // Personal still private for A
    const personalA = listA.find((w) => w.isPersonalHome);
    assert(personalA && personalA.id === accountA.orgId, 'A personal home unchanged');
    const membersPersonal = await listWorkspaceMembers({
      actorUserId: accountA.id,
      organizationId: accountA.orgId,
    });
    assert(
      membersPersonal.every((m) => m.userId === accountA.id),
      'personal only has A'
    );
    console.log('PASS personal workspace remains private');

    console.log('\nP0.5 frontend two-account verification: ALL PASS');
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
