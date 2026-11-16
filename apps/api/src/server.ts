import { config } from './config.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { startWorker } from './queue/queue.js';

async function main() {
  if (process.env.MIGRATE_ON_START !== 'false') {
    const applied = await migrate();
    if (applied.length) logger.info({ applied }, 'migrations applied');
  }
  const app = createApp();
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'REPAIRVERSE API listening'));
  const stopWorker = config.RUN_WORKER_IN_PROCESS === 'true' ? startWorker() : () => {};
  const shutdown = () => {
    logger.info('shutting down');
    stopWorker();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
