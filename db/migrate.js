// Minimal migration runner — applies db/schema.sql to DATABASE_URL.
// Loads .env from the project root automatically (via apps/api's
// installed dotenv package) so `npm run db:migrate` works standalone —
// no need to set DATABASE_URL manually on the command line.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const { Client } = require('pg'); // provided by apps/api's node_modules at runtime
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    console.log('✅ Schema applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
