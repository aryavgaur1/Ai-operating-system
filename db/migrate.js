// Minimal migration runner — applies db/schema.sql then any
// files in db/migrations/*.sql (sorted) to DATABASE_URL.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const { Client } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    await client.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('✅ Schema applied successfully.');

    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        console.log(`✅ Migration applied: ${file}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
