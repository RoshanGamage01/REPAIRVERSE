import { logger } from './lib/logger.js';
import { startWorker } from './queue/queue.js';
import './modules/knowledge/ingestion.js';

const stop = startWorker();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  logger.info('worker stopping');
  stop();
  setTimeout(() => process.exit(0), 2000);
});
