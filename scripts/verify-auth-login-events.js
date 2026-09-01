#!/usr/bin/env node
/**
 * Auth login event regressions — dedup, recording, admin gate helpers.
 * Run: npm run build -w apps/api && node scripts/verify-auth-login-events.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  let authLoginEvents;
  let platformAdmin;
  try {
    authLoginEvents = require('../apps/api/dist/lib/authLoginEvents.js');
    platformAdmin = require('../apps/api/dist/lib/platformAdmin.js');
  } catch (err) {
    console.error('FAIL load dist:', err.message);
    console.error('Run: npm run build -w apps/api');
    process.exit(1);
  }

  const {
    buildWelcomeMessage,
    hasRecentSuccessfulLogin,
    recordSuccessfulLogin,
    platformAdminRecipient,
  } = authLoginEvents;

  assert(buildWelcomeMessage('Rahul Sharma', 'rahul@example.com') === 'Welcome back, Rahul.', 'welcome message');
  assert(platformAdminRecipient() === platformAdmin.getPlatformAdminEmail(), 'platform admin recipient');
  assert(!platformAdmin.isPlatformAdminEmail('member@example.com'), 'member is not platform admin');

  if (!process.env.DATABASE_URL) {
    console.log('SKIP DB tests (DATABASE_URL unset)');
    console.log('PASS static auth login event checks');
    return;
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const suffix = Date.now().toString(36);
  const email = `login.audit.${suffix}@example.com`;
  let userId;
  let orgId;

  try {
    const org = await client.query(
      `insert into organizations (name, slug, kind) values ($1,$2,'personal') returning id`,
      [`Login Audit ${suffix}`, `login-audit-${suffix}`]
    );
    orgId = org.rows[0].id;

    const user = await client.query(
      `insert into users (organization_id, active_organization_id, email, display_name, role, password_hash, is_verified, auth_provider)
       values ($1,$1,$2,'Login Tester','member','x',true,'email')
       returning id`,
      [orgId, email]
    );
    userId = user.rows[0].id;

    const first = await recordSuccessfulLogin({
      userId,
      email,
      displayName: 'Login Tester',
      homeOrganizationId: orgId,
      authMethod: 'password',
      ip: '127.0.0.1',
      userAgent: 'jest',
      device: 'desktop',
      browser: 'node',
      os: 'test',
    });
    assert(first.loginEventId, 'first login event created');
    assert(!first.skippedDuplicate, 'first login not duplicate');

    const dup = await recordSuccessfulLogin({
      userId,
      email,
      displayName: 'Login Tester',
      homeOrganizationId: orgId,
      authMethod: 'password',
      ip: '127.0.0.1',
      userAgent: 'jest',
      device: 'desktop',
      browser: 'node',
      os: 'test',
    });
    assert(dup.skippedDuplicate, 'duplicate login skipped');

    const recent = await hasRecentSuccessfulLogin(userId, 'password');
    assert(recent, 'recent login detected');

    const count = await client.query(
      `select count(*)::int as c from login_history where user_id = $1 and success = true`,
      [userId]
    );
    assert(count.rows[0].c === 1, 'exactly one successful login event');

    const failed = await client.query(
      `insert into login_history (user_id, organization_id, ip, device, browser, success, authentication_method)
       values ($1,$2,'127.0.0.1','desktop','node',false,'password') returning id`,
      [userId, orgId]
    );
    assert(failed.rows[0].id, 'failed login row allowed');

    const successCount = await client.query(
      `select count(*)::int as c from login_history where user_id = $1 and success = true`,
      [userId]
    );
    assert(successCount.rows[0].c === 1, 'failed login did not increment successful count');

    console.log('PASS DB auth login event checks');
  } finally {
    if (userId) await client.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
    if (orgId) await client.query(`delete from organizations where id = $1`, [orgId]).catch(() => undefined);
    await client.end();
  }
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
