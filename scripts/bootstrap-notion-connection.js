/**
 * One-shot: attach platform NOTION_API_KEY as the founder user's Notion connection.
 * Run inside Railway: railway ssh -s awake-freedom -- node scripts/bootstrap-notion-connection.js
 */
const { Client } = require('pg');
const crypto = require('crypto');

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length < 32) {
    return crypto.createHash('sha256').update('dev-only-insecure-key').digest();
  }
  // Must match packages/stores/src/oauthStore.ts
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
  const databaseUrl = process.env.DATABASE_URL;
  const notionToken = process.env.NOTION_API_KEY?.trim();
  if (!databaseUrl || !notionToken) {
    console.error('MISSING_ENV', { db: !!databaseUrl, notion: !!notionToken });
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

  const users = await client.query(
    `select id, email, organization_id
     from users
     where lower(email) in ('aryavgaur1@gmail.com', 'aryavgaur01@gmail.com')
     order by case when lower(email) = 'aryavgaur1@gmail.com' then 0 else 1 end, created_at asc`
  );
  if (!users.rows.length) {
    console.error('NO_MATCHING_USER');
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
