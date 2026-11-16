import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { one } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { ah, isUuid } from '../../lib/http.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rateLimit.js';
import { assertFileAccess, extractVideoKeyframes, storeUpload } from '../../storage/files.js';
import { storage, verifyLocalSignature } from '../../storage/storage.js';

export const filesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 8 } });

filesRouter.post(
  '/',
  requireAuth,
  rateLimit({ name: 'upload', limit: 60 }),
  upload.array('files', 8),
  ah(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw badRequest('No files uploaded (field name: files)');
    const purpose = String(req.body?.purpose ?? 'general').slice(0, 40);
    const out = [];
    for (const f of files) {
      const stored = await storeUpload({ buffer: f.buffer, originalName: f.originalname, declaredMime: f.mimetype, ownerId: req.user!.id, purpose });
      const keyframes = stored.kind === 'video' ? await extractVideoKeyframes(stored.id, req.user!.id) : [];
      out.push({ ...stored, keyframeFileIds: keyframes, url: `/api/v1/files/${stored.id}/raw` });
    }
    res.status(201).json({ files: out });
  }),
);

/** Authenticated access (owner, org via job, staff, or public file). */
filesRouter.get(
  '/:id/raw',
  ah(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('File');
    const f = await assertFileAccess(req.params.id, req.user);
    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', f.kind === 'document' ? 'attachment' : 'inline');
    res.send(await storage.get(f.storage_key));
  }),
);

/** Time-limited signed URL. */
filesRouter.get(
  '/:id/url',
  ah(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('File');
    const f = await assertFileAccess(req.params.id, req.user);
    res.json({ url: await storage.signedUrl(f.storage_key, f.id), expiresInSeconds: 900 });
  }),
);

filesRouter.get(
  '/:id/content',
  ah(async (req, res) => {
    if (!isUuid(req.params.id) || !verifyLocalSignature(req.params.id, String(req.query.exp ?? ''), String(req.query.sig ?? ''))) throw forbidden('Invalid or expired link');
    const f = await one('SELECT storage_key, mime_type, kind FROM files WHERE id = $1', [req.params.id]);
    if (!f) throw notFound('File');
    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(await storage.get(f.storage_key));
  }),
);

filesRouter.get(
  '/:id/public',
  ah(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('File');
    const f = await one('SELECT storage_key, mime_type FROM files WHERE id = $1 AND is_public', [req.params.id]);
    if (!f) throw notFound('File');
    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(await storage.get(f.storage_key));
  }),
);
