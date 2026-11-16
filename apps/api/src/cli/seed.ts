import { seed } from '../db/seed.js';
import { pool } from '../db/pool.js';

const production = process.env.NODE_ENV === 'production';
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@repairverse.dev';
const adminPassword = process.env.ADMIN_PASSWORD ?? (production ? '' : 'admin-password-123');
if (!adminPassword || adminPassword.length < 10) {
  console.error('ADMIN_PASSWORD (min 10 characters) is required');
  process.exit(1);
}
seed({ demo: (process.env.SEED_DEMO ?? (production ? 'false' : 'true')) === 'true', adminEmail, adminPassword })
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
