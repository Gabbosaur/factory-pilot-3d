/**
 * Adattatore_Memoria: factory memory stored in the browser (LocalMemory: samples + closed interventions),
 * with the exact similarity filter so only genuinely similar interventions become citations (Req 15.2).
 */
import type { MemoryEntry } from '@/shared/types';
import { filterSimilar, type MemoryQuery } from './filter';
import { localMemory } from './local';

export type MemorySource = 'locale';

export async function searchMemory(q: MemoryQuery & { symptom: string }): Promise<{ entries: MemoryEntry[]; source: MemorySource }> {
  return { entries: filterSimilar(localMemory.all(), q), source: 'locale' };
}

/** Saved locally, immediately searchable. */
export async function saveMemory(entry: MemoryEntry): Promise<{ evolus: false }> {
  localMemory.save(entry);
  return { evolus: false };
}

export async function resetMemory(): Promise<void> {
  localMemory.reset();
}
