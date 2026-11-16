import type { Request } from 'express';
import { pool, type Queryable } from '../db/pool.js';
import { logger } from './logger.js';

export async function audit(
  req: Pick<Request, 'user' | 'ip'> | null,
  action: string,
  entityType: string | null,
  entityId: string | null,
  details: Record<string, unknown> = {},
  db: Queryable = pool,
): Promise<void> {
  try {
    await db.query('INSERT INTO audit_logs(actor_id, actor_kind, action, entity_type, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      req?.user?.id ?? null,
      req?.user ? 'user' : 'system',
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      req?.ip ?? null,
    ]);
  } catch (e) {
    logger.error({ err: (e as Error).message, action }, 'audit log write failed');
    if (db !== pool) throw e; // inside a transaction, auditing must not silently fail
  }
}

/** Product-success instrumentation (see PRODUCT_SPECIFICATION.md §Metrics). */
export async function track(name: string, userId: string | null | undefined, entityId: string | null | undefined, properties: Record<string, unknown> = {}, db: Queryable = pool): Promise<void> {
  try {
    await db.query('INSERT INTO analytics_events(name, user_id, entity_id, properties) VALUES ($1,$2,$3,$4)', [name, userId ?? null, entityId ?? null, JSON.stringify(properties)]);
  } catch (e) {
    logger.warn({ err: (e as Error).message, name }, 'analytics write failed');
  }
}
