// Schema migration runner.
//
// Applies every db/migrations/*.sql file that has not been applied yet, in
// lexical order, each in its own transaction, and records it in
// schema_migrations. An advisory lock stops two processes migrating at once.
//
// Runs at server boot (unless DB_AUTO_MIGRATE=false) and via `npm run db:migrate`.
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');
const LOCK_KEY = 815550321; // arbitrary, constant per application

async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    const ran = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        err.message = `Migration ${file} failed: ${err.message}`;
        throw err;
      }
      log(`[migrate] applied ${file}`);
      ran.push(file);
    }
    if (ran.length === 0) log('[migrate] schema is up to date');
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
