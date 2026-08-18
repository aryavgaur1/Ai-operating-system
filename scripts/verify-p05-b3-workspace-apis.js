#!/usr/bin/env node
/**
 * P0.5 B3 — Workspace APIs verification (local DB + dist services).
 *
 * Usage: node scripts/verify-p05-b3-workspace-apis.js
 * Requires: DATABASE_URL and built apps/api dist.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(process.env.DATABASE_URL, 'DATABASE_URL required');

  let workspaceService;
  let workspaceAuth;
  let authMiddleware;
  try {
    workspaceService = require('../apps/api/dist/lib/workspaceService.js');
    workspaceAuth = require('../apps/api/dist/lib/workspaceAuth.js');
    authMiddleware = require('../apps/api/dist/middleware/auth.js');
  } catch (err) {
    console.error('FAIL load dist:', err.message);
    console.error('Run: npm run build -w packages/shared && npm run build -w packages/stores && npm run build -w apps/api');
    process.exit(1);
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const suffix = Date.now().toString(36);
  const email = `b3.ws.${suffix}@example.com`;
  let userId;
  let personalOrgId;
  let foreignOrgId;

  const {
    listWorkspacesForUser,
    createTeamWorkspace,
    selectActiveWorkspace,
    resolveWorkspaceContext,
  } = workspaceService;
  const { MembershipAuthorizationError } = workspaceAuth;
  const { loadActingUser, signAccessToken } = authMiddleware;

  try {
    const personal = await client.query(
      `insert into organizations (name, slug, kind) values ($1,$2,'personal') returning id`,
      [`B3 Personal ${suffix}`, `b3-personal-${suffix}`]
    );
    personalOrgId = personal.rows[0].id;

    const foreign = await client.query(
      `insert into organizations (name, slug, kind) values ($1,$2,'team') returning id`,
      [`B3 Foreign ${suffix}`, `b3-foreign-${suffix}`]
    );
    foreignOrgId = foreign.rows[0].id;

    const user = await client.query(
      `insert into users (organization_id, active_organization_id, email, display_name, role, password_hash, is_verified)
       values ($1,$1,$2,'B3 User','owner','x',true) returning id`,
      [personalOrgId, email]
    );
    userId = user.rows[0].id;

    await client.query(
      `insert into organization_memberships (organization_id, user_id, role, status)
       values ($1,$2,'owner','active')`,
      [personalOrgId, userId]
    );
    await client.query(
      `insert into user_workspace_state (user_id, organization_id) values ($1,$2) on conflict do nothing`,
      [userId, personalOrgId]
    );

    // Snapshot personal before team create
    const beforeHome = await client.query(`select organization_id, active_organization_id from users where id=$1`, [
      userId,
    ]);
    const beforeConv = await client.query(`select count(*)::int as c from conversations where user_id=$1`, [userId]);
    const beforeMsg = await client.query(
      `select count(*)::int as c from messages m join conversations c on c.id=m.conversation_id where c.user_id=$1`,
      [userId]
    );

    // 1. List only active memberships
    let list = await listWorkspacesForUser(userId);
    assert(list.length === 1, 'expected only personal');
    assert(list[0].id === personalOrgId && list[0].kind === 'personal', 'personal in list');
    assert(list[0].isPersonalHome && list[0].isActive, 'personal home active');
    console.log('PASS 1 lists only active memberships');

    // 2. Retrieve personal
    const ctx = await resolveWorkspaceContext(userId);
    assert(ctx.organizationId === personalOrgId && ctx.kind === 'personal', 'personal context');
    console.log('PASS 2 retrieve personal workspace');

    // 3+4. Create team + owner
    const team = await createTeamWorkspace({ userId, name: `Acme ${suffix}` });
    assert(team.kind === 'team' && team.role === 'owner' && team.status === 'active', 'team owner');
    assert(!team.isPersonalHome, 'team is not personal home');
    console.log('PASS 3 create team workspace');
    console.log('PASS 4 creator becomes owner');

    // 5. Personal unchanged
    const afterHome = await client.query(`select organization_id, active_organization_id from users where id=$1`, [
      userId,
    ]);
    assert(afterHome.rows[0].organization_id === beforeHome.rows[0].organization_id, 'home org id unchanged');
    assert(
      afterHome.rows[0].organization_id === personalOrgId,
      'personal organization_id still personal'
    );
    // create must not auto-activate team
    assert(afterHome.rows[0].active_organization_id === personalOrgId, 'active still personal after create');
    const afterConv = await client.query(`select count(*)::int as c from conversations where user_id=$1`, [userId]);
    const afterMsg = await client.query(
      `select count(*)::int as c from messages m join conversations c on c.id=m.conversation_id where c.user_id=$1`,
      [userId]
    );
    assert(afterConv.rows[0].c === beforeConv.rows[0].c, 'no conversation created on team create');
    assert(afterMsg.rows[0].c === beforeMsg.rows[0].c, 'no messages changed');
    console.log('PASS 5 personal organization remains unchanged');

    list = await listWorkspacesForUser(userId);
    assert(list.length === 2, 'personal + team');
    assert(list.some((w) => w.id === team.id && w.kind === 'team'), 'team listed');

    // 6. Select own team
    const activated = await selectActiveWorkspace({ userId, organizationId: team.id });
    assert(activated.organizationId === team.id && activated.kind === 'team', 'activated team');
    const activeRow = await client.query(`select active_organization_id from users where id=$1`, [userId]);
    assert(activeRow.rows[0].active_organization_id === team.id, 'active_organization_id updated');
    const convAfterActivate = await client.query(`select count(*)::int as c from conversations where user_id=$1`, [
      userId,
    ]);
    assert(convAfterActivate.rows[0].c === beforeConv.rows[0].c, 'activate does not create conversation');
    console.log('PASS 6 select own active team workspace');

    // JWT for team loads
    const actingTeam = await loadActingUser(userId, team.id);
    assert(actingTeam && actingTeam.organizationId === team.id, 'JWT team org authorized');

    // 7. Cannot select foreign org
    let failed = false;
    try {
      await selectActiveWorkspace({ userId, organizationId: foreignOrgId });
    } catch (e) {
      failed = e instanceof MembershipAuthorizationError || /not a member|not found/i.test(String(e.message));
    }
    assert(failed, 'foreign activate must fail');
    console.log('PASS 7 cannot select organization without membership');

    // 8. Inactive
    await client.query(
      `update organization_memberships set status='inactive' where user_id=$1 and organization_id=$2`,
      [userId, team.id]
    );
    failed = false;
    try {
      await selectActiveWorkspace({ userId, organizationId: team.id });
    } catch (e) {
      failed =
        e instanceof MembershipAuthorizationError &&
        (e.code === 'membership_inactive' || e.code === 'membership_required');
    }
    assert(failed, 'inactive activate must fail');
    console.log('PASS 8 cannot select inactive membership');

    // 9. Removed
    await client.query(
      `update organization_memberships set status='removed' where user_id=$1 and organization_id=$2`,
      [userId, team.id]
    );
    failed = false;
    try {
      await selectActiveWorkspace({ userId, organizationId: team.id });
    } catch (e) {
      failed = e instanceof MembershipAuthorizationError && e.code === 'membership_removed';
    }
    assert(failed, 'removed activate must fail');
    console.log('PASS 9 cannot select removed membership');

    // Restore team membership for remaining checks
    await client.query(
      `update organization_memberships set status='active', role='owner' where user_id=$1 and organization_id=$2`,
      [userId, team.id]
    );
    await selectActiveWorkspace({ userId, organizationId: personalOrgId });

    // 10. Invalid org id
    failed = false;
    try {
      await selectActiveWorkspace({ userId, organizationId: 'not-a-uuid' });
    } catch (e) {
      failed = /Invalid organizationId/i.test(String(e.message));
    }
    assert(failed, 'invalid uuid must fail');
    console.log('PASS 10 invalid organization IDs fail safely');

    // 11. Cross-org JWT fails
    const forged = signAccessToken(userId, foreignOrgId);
    const { verifyToken } = authMiddleware;
    const payload = verifyToken(forged);
    const denied = await loadActingUser(userId, payload.org);
    assert(denied === null, 'cross-org JWT denied');
    console.log('PASS 11 cross-organization access fails closed');

    // 12. Active always authorized
    await selectActiveWorkspace({ userId, organizationId: team.id });
    const current = await resolveWorkspaceContext(userId);
    assert(current.organizationId === team.id, 'current is team');
    const mem = await workspaceAuth.assertActiveMembership(userId, current.organizationId);
    assert(mem.status === 'active', 'current has active membership');
    console.log('PASS 12 active organization corresponds to authorized membership');

    // Stale active → personal fallback
    await client.query(`update users set active_organization_id = $1 where id = $2`, [foreignOrgId, userId]);
    const repaired = await resolveWorkspaceContext(userId);
    assert(repaired.organizationId === personalOrgId, 'stale active falls back to personal');
    const repairedRow = await client.query(`select active_organization_id from users where id=$1`, [userId]);
    assert(repairedRow.rows[0].active_organization_id === personalOrgId, 'stale active repaired to home');
    console.log('PASS 12b stale active_organization_id falls back to personal home');

    // 13. Existing seeded user
    const existing = await client.query(
      `select id, organization_id from users where email=$1`,
      ['aryavgaur1@gmail.com']
    );
    if (existing.rows[0]) {
      const listExisting = await listWorkspacesForUser(existing.rows[0].id);
      assert(listExisting.some((w) => w.isPersonalHome), 'existing user has personal');
      const loaded = await loadActingUser(existing.rows[0].id, existing.rows[0].organization_id);
      assert(loaded, 'existing user auth');
      console.log('PASS 13 existing users continue working');
    } else {
      console.log('SKIP 13 no seeded user');
    }

    console.log('SUMMARY P0.5 B3 workspace APIs verification passed');
  } finally {
    try {
      if (userId) await client.query(`delete from users where id=$1`, [userId]);
      // cascade deletes orgs via memberships? users delete won't delete orgs. delete orgs created.
      const orgs = await client.query(
        `select id from organizations where slug like $1 or slug like $2 or name like $3`,
        [`b3-personal-${suffix}`, `b3-foreign-${suffix}`, `Acme ${suffix}`]
      );
      for (const r of orgs.rows) {
        await client.query(`delete from organizations where id=$1`, [r.id]);
      }
      if (personalOrgId) await client.query(`delete from organizations where id=$1`, [personalOrgId]).catch(() => {});
      if (foreignOrgId) await client.query(`delete from organizations where id=$1`, [foreignOrgId]).catch(() => {});
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
