/**
 * One-shot: attach platform NOTION_API_KEY as the founder user's Notion connection.
 * Run with env loaded, e.g.:
 *   node scripts/bootstrap-notion-connection.js
 *   railway run -s awake-freedom -- node scripts/bootstrap-notion-connection.js
 *
 * Token encryption MUST match packages/stores/src/oauthStore.ts getKey():
 * sha256(TOKEN_ENCRYPTION_KEY) when the env value is at least 32 chars;
 * otherwise sha256('dev-only-insecure-key'). Do not use Buffer.from(hex, 'hex')
 * here — that would make Railway-written rows undecryptable by the API.
 */
const path = require('path');
const { Client } = require('pg');
const crypto = require('crypto');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  /* dotenv is optional when vars are already in the process env (Railway). */
}

function getKey() {
  const hex = (process.env.TOKEN_ENCRYPTION_KEY || '').trim();
  if (!hex || hex.length < 32) {
    return crypto.createHash('sha256').update('dev-only-insecure-key').digest();
  }
  return crypto.createHash('sha256').update(hex).digest();
}

function encryptToken(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

(async () => {
  const databaseUrl = (
    process.env.DATABASE_URL ||
    process.env.DATABASE_PRIVATE_URL ||
    process.env.POSTGRES_URL ||
    ''
  ).trim();
  const notionToken = process.env.NOTION_API_KEY?.trim();
  if (!databaseUrl || !notionToken) {
    console.error('MISSING_ENV', {
      db: !!databaseUrl,
      notion: !!notionToken,
      hint: 'Set DATABASE_URL and NOTION_API_KEY (load .env, or use railway run so service vars are injected). railway ssh does not always expose them.',
    });
    process.exit(1);
  }

  const meRes = await fetch('https://api.notion.com/v1/users/me', {
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
    },
  });
  const meBody = await meRes.json().catch(() => ({}));
  if (!meRes.ok) {
    console.error('NOTION_TOKEN_INVALID', meRes.status, JSON.stringify(meBody).slice(0, 240));
    process.exit(2);
  }

  const workspaceName =
    meBody?.bot?.workspace_name ||
    meBody?.bot?.owner?.workspace?.name ||
    meBody?.name ||
    'Notion workspace';
  console.log('notion_ok', { type: meBody.type || meBody.object, workspaceName });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const founderEmails = [
    ...new Set(
      [
        process.env.PLATFORM_ADMIN_EMAIL,
        process.env.ADMIN_SEED_EMAIL,
        'aryavgaur1@gmail.com',
        'aryavgaur01@gmail.com',
      ]
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
    ),
  ];

  const users = await client.query(
    `select id, email, organization_id
     from users
     where lower(email) = any($1::text[])
     order by created_at asc`,
    [founderEmails]
  );
  if (!users.rows.length) {
    console.error('NO_MATCHING_USER', { lookedFor: founderEmails });
    process.exit(3);
  }

  const encrypted = encryptToken(notionToken);
  const metadata = JSON.stringify({
    workspaceName,
    connectedAt: new Date().toISOString(),
    method: 'internal_token_admin_bootstrap',
  });

  for (const u of users.rows) {
    await client.query(
      `insert into oauth_connections
         (organization_id, user_id, tool, encrypted_access_token, status, metadata, last_used_at, connected_at, updated_at)
       values ($1, $2, 'notion', $3, 'active', $4::jsonb, now(), now(), now())
       on conflict (organization_id, user_id, tool)
       do update set
         encrypted_access_token = excluded.encrypted_access_token,
         status = 'active',
         metadata = coalesce(oauth_connections.metadata, '{}'::jsonb) || excluded.metadata,
         last_used_at = now(),
         updated_at = now()`,
      [u.organization_id, u.id, encrypted, metadata]
    );
    console.log('connected', u.email);
  }

  const check = await client.query(
    `select u.email, c.status, c.metadata->>'workspaceName' as workspace, c.metadata->>'method' as method,
            (c.encrypted_access_token is not null) as has_token
     from oauth_connections c
     join users u on u.id = c.user_id
     where c.tool = 'notion' and c.status = 'active'`
  );
  console.log('active_notion', JSON.stringify(check.rows));
  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
