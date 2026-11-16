import { Router } from 'express';
import multer from 'multer';
import { AddSymptomsInput, AnswerProbeInput, RepairDecisionInput, StartDiagnosisInput } from '@repairverse/shared';
import { one, query } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { ah, isUuid, pageParams, parse } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rateLimit.js';
import { assertOwnFiles } from '../../storage/files.js';
import { transcribeAudio } from '../../ai/operations.js';
import { addSymptoms, answerProbe, assertSessionAccess, completeDiagnosis, getDiagnosisView, retractObservation, startDiagnosis } from './service.js';
import { buildGuide, procedureView } from './guide.js';
import { repairDecision } from './decision.js';

export const diagnosisRouter = Router();

diagnosisRouter.post(
  '/',
  requireAuth,
  rateLimit({ name: 'diagnose', limit: 30 }),
  ah(async (req, res) => {
    const i = parse(StartDiagnosisInput, req.body);
    await assertOwnFiles(i.fileIds, req.user);
    res.status(201).json(await startDiagnosis(i, { user: req.user }));
  }),
);

diagnosisRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const rows = await query(
      `SELECT d.id, d.status, d.description, d.created_at, d.completed_at, d.saved, d.result, d.device_id, p.name AS product_name, p.model_number, c.name AS category_name
         FROM diagnosis_sessions d LEFT JOIN products p ON p.id = d.product_id LEFT JOIN categories c ON c.id = d.category_id
        WHERE d.user_id = $1 AND d.job_id IS NULL ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset],
    );
    res.json({ diagnoses: rows });
  }),
);

diagnosisRouter.get('/:id', requireAuth, ah(async (req, res) => res.json(await getDiagnosisView(req.params.id, req.user))));

diagnosisRouter.post(
  '/:id/symptoms',
  requireAuth,
  ah(async (req, res) => res.json(await addSymptoms(req.params.id, parse(AddSymptomsInput, req.body), req.user))),
);

diagnosisRouter.post(
  '/:id/answers',
  requireAuth,
  ah(async (req, res) => res.json(await answerProbe(req.params.id, parse(AnswerProbeInput, req.body), req.user))),
);

diagnosisRouter.delete(
  '/:id/observations/:obsId',
  requireAuth,
  ah(async (req, res) => res.json(await retractObservation(req.params.id, req.params.obsId, req.user))),
);

diagnosisRouter.post(
  '/:id/complete',
  requireAuth,
  ah(async (req, res) => res.json(await completeDiagnosis(req.params.id, req.user, { save: req.body?.save !== false }))),
);

diagnosisRouter.post(
  '/:id/reopen',
  requireAuth,
  ah(async (req, res) => {
    const s = await one('SELECT * FROM diagnosis_sessions WHERE id = $1', [req.params.id]);
    if (!s) throw notFound('Diagnosis');
    assertSessionAccess(s, req.user);
    await query(`UPDATE diagnosis_sessions SET status = 'active' WHERE id = $1`, [s.id]);
    res.json(await getDiagnosisView(s.id, req.user));
  }),
);

diagnosisRouter.post(
  '/:id/guide',
  requireAuth,
  rateLimit({ name: 'guide', limit: 20 }),
  ah(async (req, res) => {
    const s = await one('SELECT * FROM diagnosis_sessions WHERE id = $1', [req.params.id]);
    if (!s) throw notFound('Diagnosis');
    assertSessionAccess(s, req.user);
    const fmId = req.body?.failureModeId ?? s.result?.hypotheses?.[0]?.failureModeId;
    if (!isUuid(fmId)) throw badRequest('No hypothesis selected');
    res.json(await buildGuide({ failureModeId: fmId, productId: s.product_id, user: req.user, generate: req.body?.generate === true }));
  }),
);

export const proceduresRouter = Router();
proceduresRouter.get('/:id', ah(async (req, res) => res.json(await procedureView(req.params.id, req.user))));

export const decisionsRouter = Router();
decisionsRouter.post('/', requireAuth, ah(async (req, res) => res.json(await repairDecision(parse(RepairDecisionInput, req.body), req.user))));

/** Voice input: speech transcription via the configured provider. */
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
export const aiRouter = Router();
aiRouter.post(
  '/transcribe',
  requireAuth,
  rateLimit({ name: 'transcribe', limit: 20 }),
  audioUpload.single('audio'),
  ah(async (req, res) => {
    const f = req.file;
    if (!f) throw badRequest('Audio file required (field name: audio)');
    if (!/^audio\/|^video\/webm/.test(f.mimetype)) throw badRequest('Unsupported audio type');
    const r = await transcribeAudio({ audio: f.buffer, mime: f.mimetype, userId: req.user!.id });
    if (!r.ok) return res.status(r.reason === 'not_configured' ? 503 : 502).json({ error: { code: r.reason, message: r.message } });
    res.json({ text: r.data.text });
  }),
);
