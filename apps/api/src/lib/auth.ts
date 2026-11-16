import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { NextFunction, Request, Response } from 'express';
import type { OrgRole, UserRole } from '@repairverse/shared';
import { config, cookieSecure } from '../config.js';
import { one, query } from '../db/pool.js';
import type { AuthUser } from '../types.js';
import { AppError, forbidden, unauthorized } from './errors.js';

export const SESSION_COOKIE = 'rv_session';

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string, req: Request, res: Response): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.SESSION_TTL_DAYS * 86400_000);
  await query('INSERT INTO sessions(user_id, token_hash, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)', [
    userId,
    sha256(token),
    expires,
    req.get('user-agent')?.slice(0, 300) ?? null,
    req.ip ?? null,
  ]);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, expires, path: '/' });
  return token;
}

export async function destroySession(req: Request, res: Response) {
  const token = readToken(req);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readToken(req: Request): string | null {
  const c = req.cookies?.[SESSION_COOKIE];
  if (c) return c;
  const h = req.get('authorization');
  if (h?.startsWith('Bearer ') && !h.startsWith('Bearer rvk_')) return h.slice(7);
  return null;
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const u = await one(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, coalesce(tp.verification_status = 'verified', false) AS tech_verified
       FROM users u LEFT JOIN technician_profiles tp ON tp.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  if (!u || u.status !== 'active') return null;
  const memberships = await query(
    `SELECT m.organization_id, m.role, o.name FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = $1 ORDER BY m.created_at`,
    [userId],
  );
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    technicianVerified: u.tech_verified,
    memberships: memberships.map((m) => ({ organizationId: m.organization_id, role: m.role, name: m.name })),
  };
}

/** Attaches req.user when a valid session exists. Never rejects. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readToken(req);
    if (token) {
      const s = await one('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
      if (s) req.user = (await loadAuthUser(s.user_id)) ?? undefined;
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must carry a
 * custom header, which browsers cannot attach cross-origin without a CORS preflight
 * (and the API does not enable CORS for cookie routes).
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.cookies?.[SESSION_COOKIE]) return next();
  if (req.get('x-requested-with') !== 'repairverse') return next(new AppError(403, 'csrf', 'Missing anti-CSRF header'));
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const isStaff = (u?: AuthUser | null) => !!u && (u.role === 'admin' || u.role === 'moderator');

/** Returns the caller's membership in the organization, or throws 403. */
export function requireOrgMember(user: AuthUser | undefined, orgId: string, roles?: OrgRole[]) {
  if (!user) throw unauthorized();
  const m = user.memberships.find((x) => x.organizationId === orgId);
  if (!m) throw forbidden('You are not a member of this organization');
  if (roles && !roles.includes(m.role)) throw forbidden('Your organization role does not permit this action');
  return m;
}

export function primaryOrgId(user: AuthUser | undefined): string {
  if (!user) throw unauthorized();
  const m = user.memberships[0];
  if (!m) throw forbidden('A repair business workspace is required. Create one in Business Settings.');
  return m.organizationId;
}
