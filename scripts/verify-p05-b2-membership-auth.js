#!/usr/bin/env node
/**
 * P0.5 B2 — Membership-authoritative auth tests (local DB).
 *
 * Requires: DATABASE_URL, and `npm run build -w apps/api` (dist/).
 *
 * Usage: node scripts/verify-p05-b2-membership-auth.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(process.env.DATABASE_URL, 'DATABASE_URL required');

  let workspaceAuth;
  let authMiddleware;
  try {
    workspaceAuth = require('../apps/api/dist/lib/workspaceAuth.js');
    authMiddleware = require('../apps/api/dist/middleware/auth.js');
  } catch (err) {
    console.error('FAIL load dist modules:', err.message);
    console.error('Run: npm run build -w packages/shared && npm run build -w packages/stores && npm run build -w apps/api');
    process.exit(1);
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const suffix = Date.now().toString(36);
  const email = `b2.auth.${suffix}@example.com`;
  let userId;
  let personalOrgId;
  let teamOrgId;
  let otherOrgId;

  try {
    const personal = await client.query(
      `insert into organizations (name, slug, kind) values ($1,$2,'personal') returning id`,
      [`B2 Personal ${suffix}`, `b2-personal-${suffix}`]
    );
    personalOrgId = personal.rows[0].id;

    const team = await client.query(
      `insert into organizations (name, slug, kind) values ($1,$2,'team') returning id`,
      [`B2 Team ${suffix}`, `b2-team-${suffix}`]
    );
    teamOrgId = team.rows[0].id;

    const other = await client.query(
      `insert into organizations (name, slug, kind) values ($1,$2,'team') returning id`,
      [`B2 Other ${suffix}`, `b2-other-${suffix}`]
    );
    otherOrgId = other.rows[0].id;

    const user = await client.query(
      `insert into users (organization_id, active_organization_id, email, display_name, role, password_hash, is_verified)
       values ($1,$1,$2,'B2 User','member','x',true)
       returning id`,
      [personalOrgId, email]
    );
    userId = user.rows[0].id;

    await client.query(
      `insert into organization_memberships (organization_id, user_id, role, status)
       values ($1,$2,'owner','active'), ($3,$2,'member','active')`,
      [personalOrgId, userId, teamOrgId]
    );
    await client.query(
      `insert into user_workspace_state (user_id, organization_id) values ($1,$2), ($1,$3)
       on conflict do nothing`,
      [userId, personalOrgId, teamOrgId]
    );

    const {
      resolveAuthorizedOrganization,
      assertActiveMembership,
      membershipAllowsRole,
      MembershipAuthorizationError,
    } = workspaceAuth;
    const { loadActingUser, signAccessToken, verifyToken } = authMiddleware;

    // 1. Personal
    const personalAuth = await resolveAuthorizedOrganization({
      userId,
      homeOrganizationId: personalOrgId,
      activeOrganizationId: personalOrgId,
      jwtOrganizationId: personalOrgId,
    });
    assert(personalAuth.organizationId === personalOrgId, 'personal org authorize');
    assert(personalAuth.membership.role === 'owner', 'personal owner role');
    console.log('PASS 1 personal organization access');

    // 2. Team membership via JWT org
    const teamAuth = await resolveAuthorizedOrganization({
      userId,
      homeOrganizationId: personalOrgId,
      activeOrganizationId: personalOrgId,
      jwtOrganizationId: teamOrgId,
    });
    assert(teamAuth.organizationId === teamOrgId, 'team org authorize');
    assert(teamAuth.membership.role === 'member', 'team member role');
    console.log('PASS 2 active membership organization access');

    // 3. No membership
    let failed = false;
    try {
      await resolveAuthorizedOrganization({
        userId,
        homeOrganizationId: personalOrgId,
        jwtOrganizationId: otherOrgId,
      });
    } catch (e) {
      failed = e instanceof MembershipAuthorizationError && e.code === 'membership_not_found';
    }
    assert(failed, 'expected membership_not_found for foreign org');
    console.log('PASS 3 no membership fails closed');

    // 4. Inactive
    await client.query(
      `update organization_memberships set status='inactive' where user_id=$1 and organization_id=$2`,
      [userId, teamOrgId]
    );
    failed = false;
    try {
      await assertActiveMembership(userId, teamOrgId);
    } catch (e) {
      failed = e instanceof MembershipAuthorizationError && e.code === 'membership_inactive';
    }
    assert(failed, 'expected membership_inactive');
    console.log('PASS 4 inactive membership fails closed');

    // 5. Removed
    await client.query(
      `update organization_memberships set status='removed' where user_id=$1 and organization_id=$2`,
      [userId, teamOrgId]
    );
    failed = false;
    try {
      await assertActiveMembership(userId, teamOrgId);
    } catch (e) {
      failed = e instanceof MembershipAuthorizationError && e.code === 'membership_removed';
    }
    assert(failed, 'expected membership_removed');
    console.log('PASS 5 removed membership fails closed');

    await client.query(
      `update organization_memberships set status='active', role='member' where user_id=$1 and organization_id=$2`,
      [userId, teamOrgId]
    );

    // 6. Member cannot owner/admin
    const mem = await assertActiveMembership(userId, teamOrgId);
    assert(mem.role === 'member', 'role is member');
    assert(!membershipAllowsRole(mem.role, ['owner', 'admin']), 'member blocked from owner/admin');
    assert(membershipAllowsRole('owner', ['owner', 'admin']), 'owner allowed');
    console.log('PASS 6 member cannot perform owner/admin-only role gate');

    // 7. Forged JWT org
    const forged = signAccessToken(userId, otherOrgId);
    const payload = verifyToken(forged);
    assert(payload.org === otherOrgId, 'forged token carries foreign org');
    const acting = await loadActingUser(userId, payload.org);
    assert(acting === null, 'loadActingUser must reject forged org without membership');
    console.log('PASS 7 org ID manipulation cannot bypass membership');

    // 8. Legacy home
    const legacy = await resolveAuthorizedOrganization({
      userId,
      homeOrganizationId: personalOrgId,
      activeOrganizationId: personalOrgId,
      jwtOrganizationId: null,
    });
    assert(legacy.organizationId === personalOrgId, 'legacy home resolves');
    const homeActing = await loadActingUser(userId, personalOrgId);
    assert(homeActing && homeActing.organizationId === personalOrgId, 'legacy authenticate shape');
    assert(homeActing.role === 'owner' || homeActing.role === 'super_admin', 'home role from membership');
    console.log('PASS 8 legacy personal authentication continues');

    // Existing local user (if any) still loads
    const existing = await client.query(
      `select id, organization_id, active_organization_id from users where email = $1`,
      ['aryavgaur1@gmail.com']
    );
    if (existing.rows[0]) {
      const eu = existing.rows[0];
      const loaded = await loadActingUser(eu.id, eu.organization_id);
      assert(loaded && loaded.organizationId === eu.organization_id, 'existing user auth');
      console.log('PASS 8b existing seeded user still authenticates');
    } else {
      console.log('SKIP 8b no seeded aryavgaur1 user');
    }

    console.log('SUMMARY P0.5 B2 membership authorization tests passed');
  } finally {
    try {
      if (userId) await client.query(`delete from users where id = $1`, [userId]);
      for (const id of [personalOrgId, teamOrgId, otherOrgId]) {
        if (id) await client.query(`delete from organizations where id = $1`, [id]);
      }
    } catch {
      // ignore
    }
    await client.end();
  }
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
