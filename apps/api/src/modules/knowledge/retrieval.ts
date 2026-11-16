/**
 * Retrieval over approved repair knowledge (RAG grounding).
 *
 * Hybrid ranking: PostgreSQL full-text search (always available) blended with pgvector cosine
 * similarity when an embedding provider is configured and chunks are embedded.
 * Only chunks from approved documents of active sources are eligible. Structured knowledge
 * citations (source excerpts attached to graph entities) are included as first-class references.
 */
import { query } from '../../db/pool.js';
import { embedTexts } from '../../ai/operations.js';

export interface Reference {
  id: string; // stable reference id: "chunk:<uuid>" or "cite:<uuid>"
  title: string;
  text: string;
  sourceId: string;
  sourceKind: string;
  sourceTitle: string;
  url: string | null;
  locator: string | null;
  reliabilityTier: number;
  score: number;
}

export async function retrieve(q: string, opts: { limit?: number; entityRefs?: { type: string; id: string }[] } = {}): Promise<Reference[]> {
  const limit = opts.limit ?? 6;
  const refs: Reference[] = [];

  // 1) Citations attached directly to the graph entities in question (highest relevance).
  if (opts.entityRefs?.length) {
    const rows = await query(
      `SELECT c.id, c.locator, c.excerpt, s.id AS source_id, s.kind, s.title, s.url, s.reliability_tier
         FROM knowledge_citations c JOIN knowledge_sources s ON s.id = c.source_id
        WHERE s.status = 'active' AND c.verification_status <> 'rejected' AND c.excerpt IS NOT NULL
          AND (c.entity_type, c.entity_id) IN (SELECT * FROM unnest($1::text[], $2::uuid[]))
        LIMIT 20`,
      [opts.entityRefs.map((e) => e.type), opts.entityRefs.map((e) => e.id)],
    );
    for (const r of rows) {
      refs.push({ id: `cite:${r.id}`, title: r.title, text: r.excerpt, sourceId: r.source_id, sourceKind: r.kind, sourceTitle: r.title, url: r.url, locator: r.locator, reliabilityTier: r.reliability_tier, score: 1 });
    }
  }

  // 2) Document chunks: lexical.
  const lexical = await query(
    `SELECT ch.id, ch.content, ch.page, ch.section, s.id AS source_id, s.kind, s.title, s.url, s.reliability_tier,
            ts_rank_cd(ch.tsv, websearch_to_tsquery('english', $1)) AS rank
       FROM document_chunks ch JOIN knowledge_sources s ON s.id = ch.source_id
      WHERE ch.approved AND s.status = 'active' AND ch.tsv @@ websearch_to_tsquery('english', $1)
      ORDER BY rank DESC LIMIT $2`,
    [toOrQuery(q), limit * 2],
  );
  const scores = new Map<string, { row: any; score: number }>();
  const maxRank = Math.max(0.0001, ...lexical.map((r) => r.rank));
  for (const r of lexical) scores.set(r.id, { row: r, score: 0.5 * (r.rank / maxRank) });

  // 3) Document chunks: semantic (only if embeddings exist and the provider is configured).
  const hasEmbeddings = (await query(`SELECT 1 FROM document_chunks WHERE embedding IS NOT NULL AND approved LIMIT 1`)).length > 0;
  if (hasEmbeddings) {
    const emb = await embedTexts([q], { type: 'retrieval_query', id: null });
    if (emb.ok) {
      const vec = `[${emb.data.vectors[0].join(',')}]`;
      const semantic = await query(
        `SELECT ch.id, ch.content, ch.page, ch.section, s.id AS source_id, s.kind, s.title, s.url, s.reliability_tier,
                1 - (ch.embedding <=> $1::vector) AS sim
           FROM document_chunks ch JOIN knowledge_sources s ON s.id = ch.source_id
          WHERE ch.approved AND s.status = 'active' AND ch.embedding IS NOT NULL
          ORDER BY ch.embedding <=> $1::vector LIMIT $2`,
        [vec, limit * 2],
      );
      for (const r of semantic) {
        const prev = scores.get(r.id);
        scores.set(r.id, { row: r, score: (prev?.score ?? 0) + 0.5 * Math.max(0, r.sim) });
      }
    }
  }
  const ranked = [...scores.values()]
    .map((x) => ({ ...x, score: x.score * (0.7 + 0.06 * x.row.reliability_tier) })) // prefer reliable sources
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  for (const { row, score } of ranked) {
    refs.push({
      id: `chunk:${row.id}`,
      title: `${row.title}${row.page ? ` (p. ${row.page})` : ''}`,
      text: row.content,
      sourceId: row.source_id,
      sourceKind: row.kind,
      sourceTitle: row.title,
      url: row.url,
      locator: row.page ? `page ${row.page}` : row.section,
      reliabilityTier: row.reliability_tier,
      score,
    });
  }
  return refs.slice(0, limit + (opts.entityRefs?.length ? 6 : 0));
}

/** Turn free text into an OR-style websearch query so partial matches still rank. */
function toOrQuery(q: string): string {
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 24);
  return words.join(' or ') || q;
}
