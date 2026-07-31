#!/usr/bin/env node
/**
 * Seeds the Super Admin account for Nexora SaaS.
 * Usage: node db/seed-admin.js
 * Password comes from ADMIN_SEED_PASSWORD env (or default for first boot).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function main() {
  const email = (process.env.ADMIN_SEED_EMAIL || 'aryavgaur1@gmail.com').toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD || 'keshuyashi';
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existing = await client.query('select id from users where email = $1', [email]);
    const hash = await bcrypt.hash(password, 12);

    if (existing.rows[0]) {
      await client.query(
        `update users set password_hash = $1, role = 'super_admin', is_verified = true, is_suspended = false where email = $2`,
        [hash, email]
      );
      console.log(`✅ Updated Super Admin: ${email}`);
    } else {
      const org = await client.query(
        `insert into organizations (name, slug) values ($1, $2) returning id`,
        ['Nexora Admin Workspace', `nexora-admin-${Math.random().toString(36).slice(2, 8)}`]
      );
      const orgId = org.rows[0].id;
      const user = await client.query(
        `insert into users (organization_id, email, display_name, role, password_hash, is_verified, auth_provider)
         values ($1, $2, $3, 'super_admin', $4, true, 'email')
         returning id`,
        [orgId, email, 'Aryav Gaur', hash]
      );
      await client.query(`insert into user_profiles (user_id, preferences) values ($1, $2::jsonb)
        on conflict (user_id) do update set preferences = user_profiles.preferences || $2::jsonb`, [
        user.rows[0].id,
        JSON.stringify({ onboardingCompleted: true }),
      ]);
      console.log(`✅ Created Super Admin: ${email}`);
    }

    // Ensure profile marks onboarding done for existing admin too
    const u = await client.query('select id from users where email = $1', [email]);
    if (u.rows[0]) {
      await client.query(
        `insert into user_profiles (user_id, preferences) values ($1, $2::jsonb)
         on conflict (user_id) do update set preferences = user_profiles.preferences || $2::jsonb`,
        [u.rows[0].id, JSON.stringify({ onboardingCompleted: true })]
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
