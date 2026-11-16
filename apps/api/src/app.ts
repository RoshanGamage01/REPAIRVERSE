import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import multer from 'multer';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { AppError, notFound } from './lib/errors.js';
import { csrfGuard, isStaff, requireAuth, sessionMiddleware } from './lib/auth.js';
import { rateLimit } from './lib/rateLimit.js';
import { ah } from './lib/http.js';
import { one, query } from './db/pool.js';
import { authRouter } from './modules/auth/routes.js';
import { catalogRouter } from './modules/catalog/routes.js';
import { filesRouter } from './modules/files/routes.js';
import { identifyRouter } from './modules/identify/routes.js';
import { aiRouter, decisionsRouter, diagnosisRouter, proceduresRouter } from './modules/diagnosis/routes.js';
import { partsRouter } from './modules/parts/routes.js';
import { libraryRouter } from './modules/library/routes.js';
import { proRouter } from './modules/pro/routes.js';
import { contributionsRouter, moderationRouter } from './modules/contributions/routes.js';
import { knowledgeRouter } from './modules/knowledge/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { developerRouter, publicApiRouter } from './modules/developer/routes.js';
import { aiAvailability } from './ai/orchestrator.js';
import './modules/knowledge/ingestion.js'; // registers background job handlers

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'"],
          scriptSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((req, res, next) => {
    req.requestId = req.get('x-request-id') ?? randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });
  app.use(pinoHttp({ logger, genReqId: (req: any) => req.requestId, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/healthz', ah(async (_req, res) => {
    await query('SELECT 1');
    res.json({ status: 'ok' });
  }));

  // Public developer API (API-key auth, no cookies).
  app.use('/api/public/v1', publicApiRouter);

  const v1 = express.Router();
  v1.use(sessionMiddleware, csrfGuard, rateLimit({ name: 'global', limit: config.RATE_LIMIT_PER_MINUTE }));
  v1.get('/status', ah(async (_req, res) => res.json({ ai: await aiAvailability(), version: '1' })));
  v1.use('/auth', authRouter);
  v1.use('/', catalogRouter);
  v1.use('/files', filesRouter);
  v1.use('/identifications', identifyRouter);
  v1.use('/diagnoses', diagnosisRouter);
  v1.use('/procedures', proceduresRouter);
  v1.use('/decisions', decisionsRouter);
  v1.use('/ai', aiRouter);
  v1.use('/parts', partsRouter);
  v1.use('/library', libraryRouter);
  v1.use('/pro', proRouter);
  v1.use('/contributions', contributionsRouter);
  v1.use('/moderation', moderationRouter);
  v1.use('/knowledge', knowledgeRouter);
  v1.use('/admin', adminRouter);
  v1.use('/developer', developerRouter);

  /** Server-sent events for long-running background jobs (e.g. document ingestion). */
  v1.get(
    '/jobs/:id/events',
    requireAuth,
    ah(async (req, res) => {
      const job = await one('SELECT id, created_by FROM background_jobs WHERE id = $1', [req.params.id]);
      if (!job || (job.created_by !== req.user!.id && !isStaff(req.user))) throw notFound('Job');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      let last = '';
      let closed = false;
      req.on('close', () => (closed = true));
      const started = Date.now();
      while (!closed && Date.now() - started < 10 * 60_000) {
        const j = await one('SELECT status, attempts, progress, result, last_error FROM background_jobs WHERE id = $1', [job.id]);
        const payload = JSON.stringify(j);
        if (payload !== last) {
          res.write(`event: update\ndata: ${payload}\n\n`);
          last = payload;
        }
        if (j && ['succeeded', 'dead'].includes(j.status)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      res.write('event: end\ndata: {}\n\n');
      res.end();
    }),
  );

  app.use('/api/v1', v1);
  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')));

  // Serve the built web client (production single-origin deployment).
  const webDist = config.SERVE_WEB_DIST ? resolve(config.SERVE_WEB_DIST) : null;
  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(resolve(webDist, 'index.html')));
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details }, requestId: req.requestId });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: { code: 'upload_error', message: err.message }, requestId: req.requestId });
    }
    const pgErr = err as { code?: string; message?: string };
    if (pgErr?.code === '23503') return res.status(400).json({ error: { code: 'invalid_reference', message: 'A referenced record does not exist' }, requestId: req.requestId });
    if (pgErr?.code === '23505') return res.status(409).json({ error: { code: 'conflict', message: 'This record already exists' }, requestId: req.requestId });
    if (pgErr?.code === '22P02') return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid identifier format' }, requestId: req.requestId });
    if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' }, requestId: req.requestId });
    logger.error({ err, requestId: req.requestId }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' }, requestId: req.requestId });
  });
  return app;
}
