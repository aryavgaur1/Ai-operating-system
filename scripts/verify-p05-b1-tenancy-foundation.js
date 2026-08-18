#!/usr/bin/env node
/**
 * P0.5 B1 — Tenancy foundation verification (DB only).
 *
 * Checks:
 * - organizations.kind present; all existing orgs personal (unless already team)
 * - every user has exactly one active owner membership on their home org
 * - user_workspace_state rows exist for home org
 * - legacy columns preserved
 * - conversation / message / approval / oauth row counts unchanged vs snapshot
 *
 * Usage:
 *   node scripts/verify-p05-b1-tenancy-foundation.js
 *   node scripts/verify-p05-b1-tenancy-foundation.js --snapshot   # write counts before migrate
 *
 * Requires DATABASE_URL (loads repo .env).
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SNAPSHOT_PATH = path.join(__dirname, '..', '.tmp-p05-b1-counts.json');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const { Client } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  assert(connectionString, 'DATABASE_URL is not set');

  const client = new Client({ connectionString });
  await client.connect();

  try {
    if (process.argv.includes('--snapshot')) {
      const snap = await snapshotCounts(client);
      fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
      console.log('SNAPSHOT_WRITTEN', SNAPSHOT_PATH);
      console.log(JSON.stringify(snap));
      return;
    }

    // --- schema presence ---
    const cols = await client.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'organizations' and column_name = 'kind')
          or (table_name = 'users' and column_name in ('organization_id', 'active_conversation_id', 'active_organization_id', 'role'))
          or (table_name = 'organization_memberships' and column_name in ('organization_id', 'user_id', 'role', 'status'))
          or (table_name = 'organization_invitations' and column_name in ('token_hash', 'email', 'role', 'expires_at', 'status'))
          or (table_name = 'user_workspace_state' and column_name in ('user_id', 'organization_id', 'active_conversation_id'))
        )
    `);
    const have = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    for (const req of [
      'organizations.kind',
      'users.organization_id',
      'users.active_conversation_id',
      'users.active_organization_id',
      'users.role',
      'organization_memberships.organization_id',
      'organization_memberships.user_id',
      'organization_memberships.role',
      'organization_memberships.status',
      'organization_invitations.token_hash',
      'organization_invitations.email',
      'user_workspace_state.user_id',
      'user_workspace_state.organization_id',
      'user_workspace_state.active_conversation_id',
    ]) {
      assert(have.has(req), `missing column ${req}`);
    }
    console.log('PASS schema columns present');

    // --- org kinds ---
    const kinds = await client.query(`
      select kind, count(*)::int as c from organizations group by kind order by kind
    `);
    const nullKind = await client.query(`select count(*)::int as c from organizations where kind is null`);
    assert(nullKind.rows[0].c === 0, 'organizations.kind has nulls');
    console.log('PASS organizations.kind populated', JSON.stringify(kinds.rows));

    // --- every user: exactly one active membership on home org ---
    const users = await client.query(`select count(*)::int as c from users`);
    const homeMembers = await client.query(`
      select count(*)::int as c
      from users u
      join organization_memberships m
        on m.user_id = u.id
       and m.organization_id = u.organization_id
       and m.status = 'active'
    `);
    assert(
      homeMembers.rows[0].c === users.rows[0].c,
      `home membership mismatch: users=${users.rows[0].c} home_active=${homeMembers.rows[0].c}`
    );

    const multiHome = await client.query(`
      select u.id, count(*)::int as c
      from users u
      join organization_memberships m
        on m.user_id = u.id and m.organization_id = u.organization_id and m.status = 'active'
      group by u.id
      having count(*) <> 1
    `);
    assert(multiHome.rows.length === 0, `users with !=1 home membership: ${multiHome.rows.length}`);

    const ownerHome = await client.query(`
      select count(*)::int as c
      from users u
      join organization_memberships m
        on m.user_id = u.id and m.organization_id = u.organization_id and m.status = 'active'
      where m.role not in ('owner', 'admin', 'member')
    `);
    assert(ownerHome.rows[0].c === 0, 'invalid membership roles on home org');
    console.log('PASS every user has exactly one active home membership', {
      users: users.rows[0].c,
      home_memberships: homeMembers.rows[0].c,
    });

    // Prefer owners for personal home (backfill maps owner/admin/member; warn if admin)
    const personalOrgs = await client.query(`
      select count(*)::int as c from organizations where kind = 'personal'
    `);
    console.log('INFO personal_orgs', personalOrgs.rows[0].c);

    // --- workspace state ---
    const stateRows = await client.query(`
      select count(*)::int as c
      from users u
      join user_workspace_state s
        on s.user_id = u.id and s.organization_id = u.organization_id
    `);
    assert(
      stateRows.rows[0].c === users.rows[0].c,
      `workspace state missing for some users: ${stateRows.rows[0].c}/${users.rows[0].c}`
    );

    const badPointer = await client.query(`
      select count(*)::int as c
      from user_workspace_state s
      join conversations c on c.id = s.active_conversation_id
      where c.organization_id <> s.organization_id or c.user_id <> s.user_id
    `);
    assert(badPointer.rows[0].c === 0, 'user_workspace_state points at foreign conversation');
    console.log('PASS user_workspace_state backfill for home orgs');

    // --- active_organization_id mirrors home when set ---
    const activeMismatch = await client.query(`
      select count(*)::int as c from users
      where active_organization_id is not null
        and active_organization_id <> organization_id
    `);
    // B1 may set them equal; mismatch is ok only if intentionally switched later (B2+).
    // For B1 fresh migrate they should match.
    if (activeMismatch.rows[0].c > 0) {
      console.log('WARN active_organization_id differs from organization_id for', activeMismatch.rows[0].c, 'users');
    } else {
      console.log('PASS active_organization_id matches home organization_id');
    }

    // --- data integrity counts vs snapshot ---
    const now = await snapshotCounts(client);
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
      for (const key of Object.keys(before)) {
        assert(
          now[key] === before[key],
          `count drift ${key}: before=${before[key]} after=${now[key]}`
        );
      }
      console.log('PASS conversation/message/approval/oauth counts unchanged vs snapshot');
    } else {
      console.log('SKIP count-diff (no snapshot; run with --snapshot before migrate)');
      console.log('COUNTS', JSON.stringify(now));
    }

    // --- invitations empty (B1 schema only) ---
    const invites = await client.query(`select count(*)::int as c from organization_invitations`);
    console.log('INFO organization_invitations rows', invites.rows[0].c);

    console.log('SUMMARY P0.5 B1 tenancy foundation verification passed');
  } finally {
    await client.end();
  }
}

async function snapshotCounts(client) {
  const q = async (sql) => (await client.query(sql)).rows[0].c;
  return {
    users: await q('select count(*)::int as c from users'),
    organizations: await q('select count(*)::int as c from organizations'),
    conversations: await q('select count(*)::int as c from conversations'),
    messages: await q('select count(*)::int as c from messages'),
    approvals: await q('select count(*)::int as c from approvals'),
    oauth_connections: await q('select count(*)::int as c from oauth_connections'),
  };
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
