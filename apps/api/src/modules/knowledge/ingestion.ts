/**
 * Knowledge ingestion pipeline (durable background job "ingest_document").
 *
 *   upload → text extraction (PDF/text) → chunking with page/section locators
 *   → prompt-injection scan → optional embeddings → structured extraction
 *     (AI when configured, deterministic rules always) → human review queue.
 *
 * Nothing extracted is applied to the knowledge graph until a reviewer approves it, and
 * chunks are only used for retrieval grounding after a reviewer approves the document.
 */
import { createHash } from 'node:crypto';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { one, query } from '../../db/pool.js';
import { storage } from '../../storage/storage.js';
import { registerHandler } from '../../queue/queue.js';
import { detectInjection } from '../../ai/guard.js';
import { embedTexts, extractKnowledge } from '../../ai/operations.js';

export interface Chunk {
  ordinal: number;
  page: number | null;
  section: string | null;
  content: string;
}

export function chunkPages(pages: string[], target = 1200): Chunk[] {
  const out: Chunk[] = [];
  let section: string | null = null;
  for (const [pi, pageText] of pages.entries()) {
    const paras = pageText.split(/\n\s*\n|\n(?=[A-Z0-9][^\n]{0,80}\n)/).map((p) => p.trim()).filter(Boolean);
    let buf = '';
    const flush = () => {
      if (buf.trim()) out.push({ ordinal: out.length, page: pages.length > 1 ? pi + 1 : null, section, content: buf.trim() });
      buf = '';
    };
    for (const para of paras) {
      const heading = para.match(/^(section\s+\d+[.:]?.*|\d+(\.\d+)*\s+[A-Z].{2,80}|[A-Z][A-Z \-]{4,60})$/im);
      if (heading && para.length < 100) {
        flush();
        section = para.slice(0, 100);
      }
      if ((buf + '\n\n' + para).length > target && buf) flush();
      buf = buf ? `${buf}\n\n${para}` : para;
    }
    flush();
  }
  return out;
}

/** Deterministic extractor: "Key: value unit" specification lines. Conservative by design. */
const SPEC_LINE = /^\s*([A-Z][A-Za-z0-9 ()/\-]{2,40}?)\s*[:=]\s*([0-9][0-9.,]*\s*(?:V|W|Wh|mAh|A|mm|cm|in|Hz|GB|TB|kg|g|°C|ohm|Ω)?)\s*$/gm;
export function ruleExtractSpecs(text: string): { key: string; value: string; quote: string }[] {
  const out: { key: string; value: string; quote: string }[] = [];
  for (const m of text.matchAll(SPEC_LINE)) out.push({ key: m[1].trim(), value: m[2].trim(), quote: m[0].trim() });
  return out.slice(0, 50);
}

async function extractText(fileId: string | null, rawText: string | null): Promise<string[]> {
  if (rawText) return [rawText];
  if (!fileId) throw new Error('Document has no file or text');
  const f = await one('SELECT storage_key, mime_type FROM files WHERE id = $1', [fileId]);
  if (!f) throw new Error('File missing');
  const buf = await storage.get(f.storage_key);
  if (f.mime_type === 'application/pdf') {
    const pages: string[] = [];
    await pdf(buf, {
      pagerender: async (pageData: any) => {
        const tc = await pageData.getTextContent();
        let last: number | null = null;
        let text = '';
        for (const item of tc.items) {
          const y = item.transform?.[5];
          text += last !== null && y !== last ? `\n${item.str}` : item.str;
          last = y;
        }
        pages.push(text);
        return text;
      },
    });
    return pages;
  }
  return [buf.toString('utf8')];
}

export async function ingestDocument(payload: { documentId: string }, progress: (p: Record<string, unknown>) => Promise<void>) {
  const doc = await one('SELECT d.*, s.title AS source_title FROM documents d JOIN knowledge_sources s ON s.id = d.source_id WHERE d.id = $1', [payload.documentId]);
  if (!doc) throw new Error('Document not found');
  await query(`UPDATE documents SET status = 'extracting', updated_at = now() WHERE id = $1`, [doc.id]);
  await progress({ stage: 'extracting_text' });
  const pages = await extractText(doc.file_id, doc.raw_text);
  const fullText = pages.join('\n\n');
  if (!fullText.trim()) throw new Error('No extractable text (scanned PDFs need OCR, which requires a multimodal provider)');

  const chunks = chunkPages(pages);
  const flags = new Set<string>();
  // Idempotent: re-running replaces chunks and pending extractions for this document.
  await query(`DELETE FROM extracted_items WHERE document_id = $1 AND status = 'pending'`, [doc.id]);
  await query(`DELETE FROM document_chunks WHERE document_id = $1`, [doc.id]);
  const chunkIds: string[] = [];
  for (const c of chunks) {
    for (const f of detectInjection(c.content)) flags.add(f);
    const r = await one(
      `INSERT INTO document_chunks(document_id, source_id, ordinal, page, section, content, content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [doc.id, doc.source_id, c.ordinal, c.page, c.section, c.content, createHash('sha256').update(c.content).digest('hex')],
    );
    chunkIds.push(r!.id);
  }
  await query(`UPDATE documents SET status = 'chunked', page_count = $2, injection_flags = $3, updated_at = now() WHERE id = $1`, [doc.id, pages.length, JSON.stringify([...flags])]);
  await progress({ stage: 'chunked', chunks: chunks.length, injectionFlags: [...flags] });

  // Embeddings (optional).
  let embedded = 0;
  const emb = await embedTexts(chunks.slice(0, 1).map((c) => c.content), { type: 'document', id: doc.id });
  if (emb.ok) {
    for (let i = 0; i < chunks.length; i += 64) {
      const batch = chunks.slice(i, i + 64);
      const r = i === 0 && batch.length === 1 ? emb : await embedTexts(batch.map((c) => c.content), { type: 'document', id: doc.id });
      if (!r.ok) break;
      for (const [j, v] of r.data.vectors.entries()) {
        await query('UPDATE document_chunks SET embedding = $2::vector WHERE id = $1', [chunkIds[i + j], `[${v.join(',')}]`]);
        embedded++;
      }
    }
  }
  await progress({ stage: 'embedded', embedded, embeddingStatus: emb.ok ? 'used' : emb.reason });

  // Structured extraction.
  let aiItems = 0;
  let aiStatus: string = 'not_attempted';
  for (const [i, c] of chunks.entries()) {
    for (const s of ruleExtractSpecs(c.content)) {
      await query(`INSERT INTO extracted_items(document_id, chunk_id, item_type, payload, confidence, extractor) VALUES ($1,$2,'product_spec',$3,0.4,'rule:spec-lines')`, [
        doc.id,
        chunkIds[i],
        JSON.stringify({ summary: `${s.key}: ${s.value}`, fields: [{ key: 'key', value: s.key }, { key: 'value', value: s.value }], supporting_quote: s.quote }),
      ]);
    }
    if (aiStatus === 'not_configured' || aiStatus === 'disabled' || aiStatus === 'budget_exceeded') continue;
    const r = await extractKnowledge({ chunkText: c.content, sourceTitle: doc.source_title, chunkId: chunkIds[i], userId: doc.created_by });
    if (!r.ok) {
      aiStatus = r.reason;
      continue;
    }
    aiStatus = 'used';
    for (const item of r.data.items) {
      await query(`INSERT INTO extracted_items(document_id, chunk_id, item_type, payload, confidence, extractor, ai_operation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        doc.id,
        chunkIds[i],
        item.item_type,
        JSON.stringify({ summary: item.summary, fields: item.fields, supporting_quote: item.supporting_quote }),
        Math.min(item.confidence, 0.8),
        `llm:${r.model}`,
        r.operationId,
      ]);
      aiItems++;
    }
    await progress({ stage: 'extracting', chunk: i + 1, of: chunks.length, aiItems });
  }
  await query(`UPDATE documents SET status = 'extracted', updated_at = now() WHERE id = $1`, [doc.id]);
  return { chunks: chunks.length, embedded, aiItems, aiStatus, injectionFlags: [...flags] };
}

registerHandler('ingest_document', (payload, ctx) => ingestDocument(payload, ctx.progress));
