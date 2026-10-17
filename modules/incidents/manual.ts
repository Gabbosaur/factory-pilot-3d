/**
 * Manuale_Markdown helpers (Req 7, 8.5). Pure.
 */
import type { Diagnosis } from '@/shared/types';

export interface ManualPage {
  n: number;
  text: string;
}

const MARKER = /<!--\s*page:\s*([^\s>]+)\s*-->/g;

export type PagesResult = { ok: true; pages: ManualPage[] } | { ok: false; error: string };

export function parsePages(md: string): PagesResult {
  const matches = [...md.matchAll(MARKER)];
  if (!matches.length) return { ok: false, error: 'Invalid manual markdown: no page markers' };
  const pages: ManualPage[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const raw = m[1]!;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1)
      return { ok: false, error: `Invalid manual markdown: non-integer page number "${raw}"` };
    if (seen.has(n)) return { ok: false, error: `Invalid manual markdown: duplicate page ${n}` };
    seen.add(n);
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : md.length;
    pages.push({ n, text: md.slice(start, end).trim() });
  }
  pages.sort((a, b) => a.n - b.n);
  return { ok: true, pages };
}

export function renderPages(pages: readonly ManualPage[]): string {
  return pages.map((p) => `<!-- page: ${p.n} -->\n${p.text}\n`).join('\n');
}

/**
 * Picks the pages most relevant to the incident to keep the request small (≤ maxPages).
 * Always includes page 1 (usually the index/overview). Scoring = keyword hits.
 */
export function selectPages(pages: readonly ManualPage[], keywords: readonly string[], maxPages = 12): ManualPage[] {
  if (pages.length <= maxPages) return [...pages];
  const kws = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 2);
  const scored = pages.map((p) => {
    const t = p.text.toLowerCase();
    return { p, score: kws.reduce((acc, k) => acc + (t.split(k).length - 1), 0) };
  });
  const first = pages.find((p) => p.n === 1);
  const picked = scored
    .filter((s) => s.p.n !== 1)
    .sort((a, b) => b.score - a.score || a.p.n - b.p.n)
    .slice(0, first ? maxPages - 1 : maxPages)
    .map((s) => s.p);
  return [...(first ? [first] : []), ...picked].sort((a, b) => a.n - b.n);
}

/** Req 8.5: unknown page ⇒ confidence 0, citation not verified. */
export function verifyCitation(d: Diagnosis, pages: readonly ManualPage[]): Diagnosis {
  const exists = pages.some((p) => p.n === d.pagina_manuale);
  return exists ? { ...d, citazione_verificata: true } : { ...d, confidenza: 0, citazione_verificata: false };
}
