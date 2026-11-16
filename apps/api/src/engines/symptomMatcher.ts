/**
 * Deterministic symptom extraction from free text against the symptom vocabulary.
 * Used when no AI provider is configured, and to cross-check AI extraction.
 */

export interface SymptomVocab {
  id: string;
  slug: string;
  name: string;
  synonyms: string[];
}

export interface SymptomMatch {
  symptomId: string;
  slug: string;
  matchedPhrase: string;
  sentence: string;
}

const NEGATIONS = new Set(['no', 'not', 'never', 'without', "doesn't", 'doesnt', "don't", 'dont', "isn't", 'isnt', "won't", 'wont', "can't", 'cant', 'cannot', 'nothing', "didn't", 'didnt', "aren't", 'arent', 'none', 'neither', 'nor']);
const STOP = new Set(['the', 'a', 'an', 'my', 'is', 'are', 'it', 'its', 'of', 'on', 'to', 'and', 'but', 'still', 'just', 'very', 'really', 'at', 'all', 'up', 'when', 'i', 'was', 'be', 'been', 'gets', 'get', 'got', 'has', 'have', 'had', 'this', 'that', 'there', 'some', 'any', 'so']);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

function contentTokens(tokens: string[]) {
  return tokens.filter((t) => !STOP.has(t)).map(stem);
}

/** Split into clauses so negation in one clause does not leak into another. */
function clauses(text: string): string[] {
  return text
    .split(/[.!?;\n]+|,\s*(?:but|and|although|though|however)\s+|\s+but\s+|\s+however\s+|\s+although\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function matchSymptoms(text: string, vocab: SymptomVocab[]): SymptomMatch[] {
  const out = new Map<string, SymptomMatch>();
  for (const clause of clauses(text)) {
    const raw = tokenize(clause);
    const toks = contentTokens(raw);
    const clauseNegated = raw.some((t) => NEGATIONS.has(t));
    for (const s of vocab) {
      if (out.has(s.id)) continue;
      for (const phrase of [s.name, ...s.synonyms]) {
        const pRaw = tokenize(phrase);
        const phraseNegative = pRaw.some((t) => NEGATIONS.has(t));
        const p = contentTokens(pRaw);
        if (!p.length) continue;
        // In-order match allowing up to 2 intervening tokens between phrase words.
        let idx = -1;
        let ok = true;
        for (const pt of p) {
          let found = -1;
          for (let j = idx + 1; j < toks.length && j <= (idx === -1 ? toks.length - 1 : idx + 3); j++) {
            if (toks[j] === pt) {
              found = j;
              break;
            }
          }
          if (found === -1) {
            ok = false;
            break;
          }
          idx = found;
        }
        if (!ok) continue;
        // A positive phrase inside a negated clause ("it is not overheating") is not a match.
        // A negative phrase ("no sound") requires the clause to carry the negation.
        if (!phraseNegative && clauseNegated) continue;
        if (phraseNegative && !clauseNegated) continue;
        out.set(s.id, { symptomId: s.id, slug: s.slug, matchedPhrase: phrase, sentence: clause });
        break;
      }
    }
  }
  return [...out.values()];
}
