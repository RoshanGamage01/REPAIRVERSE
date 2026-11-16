import { Router } from 'express';
import { ConfirmIdentificationInput, IdentifyInput } from '@repairverse/shared';
import { one } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { ah, parse } from '../../lib/http.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rateLimit.js';
import { assertOwnFiles } from '../../storage/files.js';
import { confirmIdentification, runIdentification } from './service.js';

export const identifyRouter = Router();

identifyRouter.post(
  '/',
  requireAuth,
  rateLimit({ name: 'identify', limit: 30 }),
  ah(async (req, res) => {
    const i = parse(IdentifyInput, req.body);
    if (!i.text && !i.modelNumber && !i.barcode && !i.fileIds.length) throw forbidden('Provide a photo, description, model number or barcode');
    await assertOwnFiles(i.fileIds, req.user);
    const row = await one(`INSERT INTO identifications(user_id, input, file_ids) VALUES ($1,$2,$3) RETURNING id`, [req.user!.id, JSON.stringify({ text: i.text, modelNumber: i.modelNumber, barcode: i.barcode }), i.fileIds]);
    res.status(201).json(await runIdentification(row!.id, req.user));
  }),
);

identifyRouter.get(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const r = await one('SELECT * FROM identifications WHERE id = $1', [req.params.id]);
    if (!r) throw notFound('Identification');
    if (r.user_id !== req.user!.id) throw forbidden();
    res.json({ id: r.id, status: r.status, input: r.input, fileIds: r.file_ids, confirmedProductId: r.confirmed_product_id, ...(r.result ?? {}) });
  }),
);

identifyRouter.post(
  '/:id/confirm',
  requireAuth,
  ah(async (req, res) => {
    res.json(await confirmIdentification(req.params.id, parse(ConfirmIdentificationInput, req.body), req.user!));
  }),
);
