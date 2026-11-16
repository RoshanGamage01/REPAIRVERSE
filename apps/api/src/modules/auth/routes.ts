import { Router } from 'express';
import { LoginInput, RegisterInput, TechnicianProfileInput } from '@repairverse/shared';
import { one, query, tx } from '../../db/pool.js';
import { createSession, destroySession, hashPassword, loadAuthUser, requireAuth, verifyPassword } from '../../lib/auth.js';
import { audit, track } from '../../lib/audit.js';
import { ah, parse, uniqueSlug } from '../../lib/http.js';
import { AppError, conflict } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rateLimit.js';

export const authRouter = Router();
const authLimiter = rateLimit({ name: 'auth', limit: 20, windowSec: 300, key: (req) => req.ip ?? 'anon' });

authRouter.post(
  '/register',
  authLimiter,
  ah(async (req, res) => {
    const input = parse(RegisterInput, req.body);
    const exists = await one('SELECT 1 FROM users WHERE email = $1', [input.email]);
    if (exists) throw conflict('An account with this email already exists');
    const pw = await hashPassword(input.password);
    const userId = await tx(async (db) => {
      const u = await one(`INSERT INTO users(email, password_hash, display_name, role) VALUES ($1,$2,$3,$4) RETURNING id`, [input.email, pw, input.displayName, input.accountType], db);
      if (input.accountType === 'technician') {
        await db.query(`INSERT INTO technician_profiles(user_id, business_name) VALUES ($1,$2)`, [u!.id, input.businessName ?? null]);
        const orgName = input.businessName?.trim() || `${input.displayName}'s Repair Workspace`;
        const org = await one(`INSERT INTO organizations(name, slug) VALUES ($1,$2) RETURNING id`, [orgName, uniqueSlug(orgName)], db);
        await db.query(`INSERT INTO memberships(organization_id, user_id, role) VALUES ($1,$2,'owner')`, [org!.id, u!.id]);
      }
      return u!.id as string;
    });
    await createSession(userId, req, res);
    const user = await loadAuthUser(userId);
    await audit({ user: user!, ip: req.ip }, 'user.registered', 'user', userId, { accountType: input.accountType });
    await track('user_registered', userId, null, { accountType: input.accountType });
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const input = parse(LoginInput, req.body);
    const u = await one('SELECT id, password_hash, status FROM users WHERE email = $1', [input.email]);
    // Constant-ish time: always run a verification.
    const ok = u ? await verifyPassword(u.password_hash, input.password) : await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$Zm9vYmFyYmF6', input.password);
    if (!u || !ok) throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
    if (u.status !== 'active') throw new AppError(403, 'suspended', 'This account is suspended');
    await createSession(u.id, req, res);
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
    res.json({ user: await loadAuthUser(u.id) });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    await destroySession(req, res);
    res.status(204).end();
  }),
);

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

// Technician profile (self)
authRouter.get(
  '/me/technician-profile',
  requireAuth,
  ah(async (req, res) => {
    const p = await one(
      `SELECT tp.*, ST_Y(tp.location::geometry) AS latitude, ST_X(tp.location::geometry) AS longitude FROM technician_profiles tp WHERE user_id = $1`,
      [req.user!.id],
    );
    const vr = await query('SELECT id, status, statement, review_notes, created_at, reviewed_at FROM verification_requests WHERE user_id = $1 ORDER BY created_at DESC', [req.user!.id]);
    const reviews = await query('SELECT rating, body, author_name, created_at FROM technician_reviews WHERE technician_id = $1 ORDER BY created_at DESC LIMIT 20', [req.user!.id]);
    const rep = await one('SELECT reputation FROM users WHERE id = $1', [req.user!.id]);
    res.json({ profile: p, verificationRequests: vr, reviews, reputation: rep?.reputation ?? 0 });
  }),
);

authRouter.put(
  '/me/technician-profile',
  requireAuth,
  ah(async (req, res) => {
    if (req.user!.role !== 'technician' && req.user!.role !== 'admin') throw new AppError(403, 'forbidden', 'Technician accounts only');
    const i = parse(TechnicianProfileInput, req.body);
    const loc = i.latitude != null && i.longitude != null ? [i.longitude, i.latitude] : null;
    await query(
      `INSERT INTO technician_profiles(user_id, headline, bio, specialties, category_ids, years_experience, service_area, location, business_name, business_phone, business_website, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::float IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($8,$9),4326)::geography END, $10,$11,$12, now())
       ON CONFLICT (user_id) DO UPDATE SET headline=EXCLUDED.headline, bio=EXCLUDED.bio, specialties=EXCLUDED.specialties, category_ids=EXCLUDED.category_ids,
         years_experience=EXCLUDED.years_experience, service_area=EXCLUDED.service_area, location=EXCLUDED.location, business_name=EXCLUDED.business_name,
         business_phone=EXCLUDED.business_phone, business_website=EXCLUDED.business_website, updated_at=now()`,
      [req.user!.id, i.headline ?? null, i.bio ?? null, i.specialties, i.categoryIds, i.yearsExperience ?? null, i.serviceArea ?? null, loc?.[0] ?? null, loc?.[1] ?? null, i.businessName ?? null, i.businessPhone ?? null, i.businessWebsite || null],
    );
    await audit(req, 'technician.profile_updated', 'user', req.user!.id);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/me/verification-requests',
  requireAuth,
  ah(async (req, res) => {
    if (req.user!.role !== 'technician') throw new AppError(403, 'forbidden', 'Technician accounts only');
    const statement = String(req.body?.statement ?? '').trim();
    const evidence = Array.isArray(req.body?.evidence) ? req.body.evidence.slice(0, 10) : [];
    if (statement.length < 10) throw new AppError(400, 'bad_request', 'Describe your qualifications (at least 10 characters)');
    const open = await one(`SELECT 1 FROM verification_requests WHERE user_id = $1 AND status IN ('pending','needs_evidence')`, [req.user!.id]);
    if (open) throw conflict('You already have an open verification request');
    const r = await one(`INSERT INTO verification_requests(user_id, statement, evidence) VALUES ($1,$2,$3) RETURNING id`, [req.user!.id, statement.slice(0, 4000), JSON.stringify(evidence)]);
    await query(`UPDATE technician_profiles SET verification_status = 'pending' WHERE user_id = $1 AND verification_status <> 'verified'`, [req.user!.id]);
    await audit(req, 'technician.verification_requested', 'verification_request', r!.id);
    res.status(201).json({ id: r!.id });
  }),
);

/** Public technician directory with geographic search (PostGIS). Only verified status is shown as verified. */
authRouter.get(
  '/technicians',
  ah(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Math.min(Number(req.query.radiusKm) || 50, 500);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
    const rows = await query(
      `SELECT u.id, u.display_name, tp.headline, tp.specialties, tp.service_area, tp.business_name, tp.verification_status, tp.years_experience,
              (SELECT round(avg(rating)::numeric,1) FROM technician_reviews r WHERE r.technician_id = u.id) AS rating,
              (SELECT count(*) FROM technician_reviews r WHERE r.technician_id = u.id)::int AS review_count,
              ${hasGeo ? 'round((ST_Distance(tp.location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)/1000)::numeric,1)' : 'NULL'} AS distance_km
         FROM users u JOIN technician_profiles tp ON tp.user_id = u.id
        WHERE u.status = 'active' ${hasGeo ? 'AND tp.location IS NOT NULL AND ST_DWithin(tp.location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3 * 1000)' : ''}
        ORDER BY ${hasGeo ? 'distance_km' : "tp.verification_status = 'verified' DESC, u.display_name"} LIMIT 50`,
      hasGeo ? [lng, lat, radiusKm] : [],
    );
    res.json({ technicians: rows });
  }),
);
