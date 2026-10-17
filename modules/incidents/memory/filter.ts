/**
 * Exact similarity filter for Memoria_Fabbrica (Req 15.2). Applied to both local and Evolus results.
 */
import type { MemoryEntry } from '@/shared/types';

export interface MemoryQuery {
  machineId: string;
  machineType: string;
  sensorIds: readonly string[];
}

export function filterSimilar(entries: readonly MemoryEntry[], q: MemoryQuery, k = 3): MemoryEntry[] {
  const seen = new Set<string>();
  return entries
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return (e.machineId === q.machineId || e.machineType === q.machineType) && e.sensorIds.some((s) => q.sensorIds.includes(s));
    })
    .sort((a, b) => (a.closedAt < b.closedAt ? 1 : a.closedAt > b.closedAt ? -1 : 0))
    .slice(0, k);
}

export function formatMemoryCitation(e: MemoryEntry): string {
  const d = new Date(e.closedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Happened on ${d}: ${e.realCause}. Fixed by: ${e.fix} in ${e.durationMin} minutes${e.isSample ? ' (sample data)' : ''}.`;
}
