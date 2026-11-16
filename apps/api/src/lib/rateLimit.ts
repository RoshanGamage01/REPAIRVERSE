import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';
import { redis } from './redis.js';

/** Fixed-window counter. Uses Redis when available so limits hold across instances; in-memory otherwise. */
const memory = new Map<string, { count: number; resetAt: number }>();

export async function hit(key: string, limit: number, windowSec = 60): Promise<{ allowed: boolean; remaining: number; resetSec: number }> {
  const r = redis();
  const windowId = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${windowId}`;
  if (r) {
    try {
      const count = await r.incr(k);
      if (count === 1) await r.expire(k, windowSec + 1);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSec: windowSec - (Math.floor(Date.now() / 1000) % windowSec) };
    } catch {
      /* fall through to memory */
    }
  }
  const now = Date.now();
  let e = memory.get(k);
  if (!e || e.resetAt < now) {
    e = { count: 0, resetAt: now + windowSec * 1000 };
    memory.set(k, e);
    if (memory.size > 50_000) for (const [mk, mv] of memory) if (mv.resetAt < now) memory.delete(mk);
  }
  e.count++;
  return { allowed: e.count <= limit, remaining: Math.max(0, limit - e.count), resetSec: Math.ceil((e.resetAt - now) / 1000) };
}

export function rateLimit(opts: { limit: number; windowSec?: number; key?: (req: Request) => string; name: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = opts.key ? opts.key(req) : req.user?.id ?? req.ip ?? 'anon';
      const r = await hit(`${opts.name}:${id}`, opts.limit, opts.windowSec ?? 60);
      res.setHeader('X-RateLimit-Limit', String(opts.limit));
      res.setHeader('X-RateLimit-Remaining', String(r.remaining));
      if (!r.allowed) {
        res.setHeader('Retry-After', String(r.resetSec));
        return next(new AppError(429, 'rate_limited', 'Too many requests. Please slow down.'));
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
