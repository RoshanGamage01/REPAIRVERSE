import { Router } from 'express';
import { DeviceEventInput, DeviceInput, ReminderInput } from '@repairverse/shared';
import { one, query, tx } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';
import { audit, track } from '../../lib/audit.js';
import { ah, parse } from '../../lib/http.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { assertFileAccess } from '../../storage/files.js';
import type { AuthUser } from '../../types.js';

export const libraryRouter = Router();
libraryRouter.use(requireAuth);

async function ownDevice(id: string, user: AuthUser) {
  const d = await one('SELECT * FROM devices WHERE id = $1', [id]);
  if (!d) throw notFound('Device');
  if (d.owner_user_id !== user.id) throw forbidden();
  return d;
}

libraryRouter.get(
  '/devices',
  ah(async (req, res) => {
    const rows = await query(
      `SELECT d.*, p.name AS product_name, p.slug AS product_slug, p.model_number, p.is_demo AS product_is_demo, v.name AS variant_name, c.name AS category_name,
              (SELECT count(*) FROM device_events e WHERE e.device_id = d.id AND e.kind IN ('repair_completed','component_replaced'))::int AS repair_count,
              (SELECT max(occurred_at) FROM device_events e WHERE e.device_id = d.id) AS last_event_at,
              (SELECT count(*) FROM reminders r WHERE r.device_id = d.id AND NOT r.done AND r.due_at < now() + interval '14 days')::int AS due_reminders
         FROM devices d LEFT JOIN products p ON p.id = d.product_id LEFT JOIN product_variants v ON v.id = d.variant_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE d.owner_user_id = $1 ORDER BY d.created_at DESC`,
      [req.user!.id],
    );
    res.json({ devices: rows });
  }),
);

libraryRouter.post(
  '/devices',
  ah(async (req, res) => {
    const i = parse(DeviceInput, req.body);
    const id = await tx(async (db) => {
      const d = await one(
        `INSERT INTO devices(owner_user_id, product_id, variant_id, nickname, serial_number, purchase_date, warranty_expires, purchase_price_cents, currency, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [req.user!.id, i.productId ?? null, i.variantId ?? null, i.nickname, i.serialNumber ?? null, i.purchaseDate ?? null, i.warrantyExpires ?? null, i.purchasePriceCents ?? null, i.currency, i.notes ?? null],
        db,
      );
      await db.query(`INSERT INTO device_events(device_id, kind, title, created_by) VALUES ($1,'registered','Added to My Devices',$2)`, [d!.id, req.user!.id]);
      if (i.warrantyExpires) {
        await db.query(`INSERT INTO device_events(device_id, kind, title, details, occurred_at, created_by) VALUES ($1,'warranty','Warranty recorded',$2, now(), $3)`, [d!.id, `Expires ${i.warrantyExpires}`, req.user!.id]);
      }
      return d!.id as string;
    });
    await track('device_registered', req.user!.id, id, { identified: !!i.productId });
    res.status(201).json({ id });
  }),
);

libraryRouter.get(
  '/devices/:id',
  ah(async (req, res) => {
    const d = await ownDevice(req.params.id, req.user!);
    const [product, events, reminders, diagnoses, outcomes] = await Promise.all([
      d.product_id ? one('SELECT p.id, p.name, p.slug, p.model_number, p.is_demo, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1', [d.product_id]) : null,
      query(
        `SELECT e.*, ct.name AS component_name, f.original_name AS file_name FROM device_events e LEFT JOIN component_types ct ON ct.id = e.component_type_id LEFT JOIN files f ON f.id = e.file_id
          WHERE e.device_id = $1 ORDER BY e.occurred_at DESC`,
        [d.id],
      ),
      query('SELECT * FROM reminders WHERE device_id = $1 ORDER BY done, due_at', [d.id]),
      query(`SELECT id, status, description, result, created_at, completed_at FROM diagnosis_sessions WHERE device_id = $1 ORDER BY created_at DESC`, [d.id]),
      query(`SELECT id, succeeded, actual_failure_text, cost_cents, currency, created_at FROM repair_outcomes WHERE device_id = $1 ORDER BY created_at DESC`, [d.id]),
    ]);
    const totalCost = events.reduce((s, e) => s + (e.cost_cents ?? 0), 0);
    res.json({ device: d, product, events, reminders, diagnoses, outcomes, totals: { repairCostCents: totalCost, currency: d.currency } });
  }),
);

libraryRouter.patch(
  '/devices/:id',
  ah(async (req, res) => {
    await ownDevice(req.params.id, req.user!);
    const i = parse(DeviceInput.partial(), req.body);
    await query(
      `UPDATE devices SET product_id = coalesce($2, product_id), variant_id = coalesce($3, variant_id), nickname = coalesce($4, nickname), serial_number = coalesce($5, serial_number),
              purchase_date = coalesce($6, purchase_date), warranty_expires = coalesce($7, warranty_expires), purchase_price_cents = coalesce($8, purchase_price_cents), notes = coalesce($9, notes)
        WHERE id = $1`,
      [req.params.id, i.productId ?? null, i.variantId ?? null, i.nickname ?? null, i.serialNumber ?? null, i.purchaseDate ?? null, i.warrantyExpires ?? null, i.purchasePriceCents ?? null, i.notes ?? null],
    );
    res.json({ ok: true });
  }),
);

libraryRouter.delete(
  '/devices/:id',
  ah(async (req, res) => {
    await ownDevice(req.params.id, req.user!);
    await query('DELETE FROM devices WHERE id = $1', [req.params.id]);
    await audit(req, 'device.deleted', 'device', req.params.id);
    res.status(204).end();
  }),
);

libraryRouter.post(
  '/devices/:id/events',
  ah(async (req, res) => {
    await ownDevice(req.params.id, req.user!);
    const i = parse(DeviceEventInput, req.body);
    if (i.fileId) await assertFileAccess(i.fileId, req.user);
    const e = await one(
      `INSERT INTO device_events(device_id, kind, title, details, cost_cents, occurred_at, file_id, diagnosis_id, component_type_id, created_by)
       VALUES ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7,$8,$9,$10) RETURNING id`,
      [req.params.id, i.kind, i.title, i.details ?? null, i.costCents ?? null, i.occurredAt ?? null, i.fileId ?? null, i.diagnosisId ?? null, i.componentTypeId ?? null, req.user!.id],
    );
    if (i.kind === 'repair_completed') await track('repair_completed_consumer', req.user!.id, req.params.id, {});
    res.status(201).json({ id: e!.id });
  }),
);

libraryRouter.delete(
  '/devices/:id/events/:eventId',
  ah(async (req, res) => {
    await ownDevice(req.params.id, req.user!);
    await query(`DELETE FROM device_events WHERE id = $1 AND device_id = $2 AND kind <> 'registered'`, [req.params.eventId, req.params.id]);
    res.status(204).end();
  }),
);

libraryRouter.post(
  '/devices/:id/reminders',
  ah(async (req, res) => {
    await ownDevice(req.params.id, req.user!);
    const i = parse(ReminderInput, req.body);
    const r = await one(`INSERT INTO reminders(user_id, device_id, title, due_at) VALUES ($1,$2,$3,$4) RETURNING id`, [req.user!.id, req.params.id, i.title, i.dueAt]);
    res.status(201).json({ id: r!.id });
  }),
);

libraryRouter.patch(
  '/reminders/:id',
  ah(async (req, res) => {
    const r = await one(`UPDATE reminders SET done = $3 WHERE id = $1 AND user_id = $2 RETURNING id`, [req.params.id, req.user!.id, req.body?.done !== false]);
    if (!r) throw notFound('Reminder');
    res.json({ ok: true });
  }),
);

libraryRouter.get(
  '/reminders',
  ah(async (req, res) => {
    res.json({
      reminders: await query(
        `SELECT r.*, d.nickname FROM reminders r LEFT JOIN devices d ON d.id = r.device_id WHERE r.user_id = $1 AND NOT r.done ORDER BY r.due_at LIMIT 50`,
        [req.user!.id],
      ),
    });
  }),
);

/** Repair history across all devices: diagnoses, repairs, replacements and costs. */
libraryRouter.get(
  '/history',
  ah(async (req, res) => {
    const events = await query(
      `SELECT e.id, e.kind, e.title, e.details, e.cost_cents, e.occurred_at, e.diagnosis_id, d.id AS device_id, d.nickname, d.currency, ct.name AS component_name
         FROM device_events e JOIN devices d ON d.id = e.device_id LEFT JOIN component_types ct ON ct.id = e.component_type_id
        WHERE d.owner_user_id = $1 AND e.kind <> 'registered' ORDER BY e.occurred_at DESC LIMIT 200`,
      [req.user!.id],
    );
    const diagnoses = await query(
      `SELECT ds.id, ds.status, ds.description, ds.result, ds.created_at, ds.saved, p.name AS product_name, c.name AS category_name, d.nickname
         FROM diagnosis_sessions ds LEFT JOIN products p ON p.id = ds.product_id LEFT JOIN categories c ON c.id = ds.category_id LEFT JOIN devices d ON d.id = ds.device_id
        WHERE ds.user_id = $1 AND ds.job_id IS NULL ORDER BY ds.created_at DESC LIMIT 100`,
      [req.user!.id],
    );
    res.json({ events, diagnoses });
  }),
);

/** Export a device's full record (JSON or CSV). */
libraryRouter.get(
  '/devices/:id/export',
  ah(async (req, res) => {
    const d = await ownDevice(req.params.id, req.user!);
    const product = d.product_id ? await one('SELECT name, model_number FROM products WHERE id = $1', [d.product_id]) : null;
    const events = await query(`SELECT e.occurred_at, e.kind, e.title, e.details, e.cost_cents, ct.name AS component FROM device_events e LEFT JOIN component_types ct ON ct.id = e.component_type_id WHERE device_id = $1 ORDER BY occurred_at`, [d.id]);
    const name = `repairverse-${d.nickname.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    await track('repair_record_exported', req.user!.id, d.id, { format: req.query.format ?? 'json' });
    if (req.query.format === 'csv') {
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        // Neutralise spreadsheet formula injection.
        const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const lines = ['date,kind,title,details,component,cost'];
      for (const e of events) lines.push([new Date(e.occurred_at).toISOString(), e.kind, e.title, e.details, e.component, e.cost_cents != null ? (e.cost_cents / 100).toFixed(2) : ''].map(esc).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      return res.send(lines.join('\n'));
    }
    res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`);
    res.json({ exportedAt: new Date().toISOString(), device: { nickname: d.nickname, serialNumber: d.serial_number, purchaseDate: d.purchase_date, warrantyExpires: d.warranty_expires, product }, timeline: events });
  }),
);
