import { migrate } from '../db/migrate.js';
import { pool } from '../db/pool.js';

migrate({ reset: process.argv.includes('--reset') })
  .then(async (applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database up to date');
    await pool.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
