/**
 * Adattatore_Memoria: Evolus (via /api/memory) merged with LocalMemory, exact filter applied
 * on the union so semantic false positives never become citations (Req 15.2, 15.10, 15.11).
 */
import type { MemoryEntry } from '@/shared/types';
import { filterSimilar, type MemoryQuery } from './filter';
import { localMemory } from './local';

const EVOLUS_TIMEOUT_MS = 5000;

export type MemorySource = 'evolus' | 'locale';

export async function searchMemory(q: MemoryQuery & { symptom: string }): Promise<{ entries: MemoryEntry[]; source: MemorySource }> {
  const local = localMemory.all();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), EVOLUS_TIMEOUT_MS);
    const r = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'search', ...q, sensorIds: [...q.sensorIds] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const body = (await r.json()) as { ok: boolean; data?: MemoryEntry[] };
    if (body.ok && body.data) return { entries: filterSimilar([...local, ...body.data], q), source: 'evolus' };
  } catch {
    /* fall through to local */
  }
  return { entries: filterSimilar(local, q), source: 'locale' };
}

/** Writes locally (immediately searchable) and to Evolus (async ingestion). */
export async function saveMemory(entry: MemoryEntry): Promise<{ evolus: boolean }> {
  localMemory.save(entry);
  try {
    const r = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'save', entry }),
    });
    const body = (await r.json()) as { ok: boolean; data?: { documentId: string | null } };
    if (body.ok && body.data?.documentId) {
      const ids = JSON.parse(localStorage.getItem('fp.evolus.docs') ?? '[]') as string[];
      localStorage.setItem('fp.evolus.docs', JSON.stringify([...ids, body.data.documentId]));
    }
    return { evolus: body.ok };
  } catch {
    return { evolus: false };
  }
}

export async function resetMemory(): Promise<void> {
  localMemory.reset();
  const ids = JSON.parse(localStorage.getItem('fp.evolus.docs') ?? '[]') as string[];
  localStorage.removeItem('fp.evolus.docs');
  if (ids.length)
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', documentIds: ids }),
    }).catch(() => undefined);
}
