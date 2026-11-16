import { hostname } from 'node:os';
import { one, pool, query, type Queryable } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export type JobHandler = (payload: any, ctx: { jobId: string; attempt: number; progress: (p: Record<string, unknown>) => Promise<void> }) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();
export function registerHandler(type: string, h: JobHandler) {
  handlers.set(type, h);
}

export interface EnqueueOptions {
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  createdBy?: string | null;
  db?: Queryable;
}

/** Enqueue a durable job. With an idempotency key, repeated enqueues return the existing job. */
export async function enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<{ id: string; status: string; deduplicated: boolean }> {
  const db = opts.db ?? pool;
  const row = await one(
    `INSERT INTO background_jobs(type, payload, idempotency_key, run_at, max_attempts, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, status`,
    [type, JSON.stringify(payload), opts.idempotencyKey ?? null, opts.runAt ?? new Date(), opts.maxAttempts ?? 5, opts.createdBy ?? null],
    db,
  );
  if (row) return { ...row, deduplicated: false };
  const existing = await one('SELECT id, status FROM background_jobs WHERE idempotency_key = $1', [opts.idempotencyKey], db);
  return { ...existing!, deduplicated: true };
}

const workerId = `${hostname()}:${process.pid}`;

/** Claim and run one ready job. Returns false when nothing was ready. */
export async function runOnce(): Promise<boolean> {
  // Recover jobs whose worker died mid-run.
  await query(`UPDATE background_jobs SET status='queued', locked_at=NULL, locked_by=NULL WHERE status='running' AND locked_at < now() - interval '10 minutes'`);
  const job = await one(
    `UPDATE background_jobs SET status='running', locked_at=now(), locked_by=$1, attempts=attempts+1, updated_at=now()
      WHERE id = (SELECT id FROM background_jobs WHERE status='queued' AND run_at <= now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`,
    [workerId],
  );
  if (!job) return false;
  const handler = handlers.get(job.type);
  const progress = async (p: Record<string, unknown>) => {
    await query('UPDATE background_jobs SET progress=$2, updated_at=now() WHERE id=$1', [job.id, JSON.stringify(p)]);
  };
  try {
    if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
    const result = await handler(job.payload, { jobId: job.id, attempt: job.attempts, progress });
    await query(`UPDATE background_jobs SET status='succeeded', result=$2, locked_at=NULL, updated_at=now() WHERE id=$1`, [job.id, JSON.stringify(result ?? null)]);
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 2000) ?? 'unknown error';
    const dead = job.attempts >= job.max_attempts;
    const backoffSec = Math.min(3600, 2 ** job.attempts * 5);
    await query(
      `UPDATE background_jobs SET status=$2, last_error=$3, locked_at=NULL, run_at=now() + ($4 || ' seconds')::interval, updated_at=now() WHERE id=$1`,
      [job.id, dead ? 'dead' : 'queued', msg, String(backoffSec)],
    );
    logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, dead, err: msg }, 'background job failed');
  }
  return true;
}

/** Drain all ready jobs (used by tests and synchronous fallbacks). */
export async function drain(max = 100): Promise<number> {
  let n = 0;
  while (n < max && (await runOnce())) n++;
  return n;
}

let stopped = false;
export function startWorker(intervalMs = 1000) {
  stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const worked = await runOnce();
        if (!worked) await new Promise((r) => setTimeout(r, intervalMs));
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'worker loop error');
        await new Promise((r) => setTimeout(r, intervalMs * 5));
      }
    }
  };
  void loop();
  logger.info({ workerId }, 'background worker started');
  return () => {
    stopped = true;
  };
}

export async function retryDeadJob(id: string) {
  return one(`UPDATE background_jobs SET status='queued', attempts=0, run_at=now(), last_error=NULL WHERE id=$1 AND status IN ('dead','failed') RETURNING id`, [id]);
}
