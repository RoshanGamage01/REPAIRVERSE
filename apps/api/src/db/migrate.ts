import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
// In the bundled build migrations are copied next to dist; in dev they live in src/db/migrations.
const candidates = [join(here, 'migrations'), join(here, 'db', 'migrations'), join(here, '..', 'src', 'db', 'migrations')];

function migrationsDir(): string {
  for (const c of candidates) {
    try {
      readdirSync(c);
      return c;
    } catch {}
  }
  throw new Error('migrations directory not found');
}

export async function migrate({ reset = false } = {}): Promise<string[]> {
  const client = await pool.connect();
  try {
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(727274)');
    return applied;
  } finally {
    client.release();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\.ts$/, '') === process.argv[1].replace(/\.(ts|js)$/, '');
if (isMain) {
  migrate({ reset: process.argv.includes('--reset') })
    .then((a) => {
      console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database up to date');
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
