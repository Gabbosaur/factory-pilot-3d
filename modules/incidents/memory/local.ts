/**
 * LocalMemory: localStorage + seed (Req 15.4, 15.5, 15.9). Browser-only.
 */
import seed from '@/data/memory-seed.json';
import { MemoryEntrySchema } from '@/shared/schemas';
import type { MemoryEntry } from '@/shared/types';

const KEY = 'fp.memory.v1';
const SEED = (seed as unknown[]).map((e) => MemoryEntrySchema.parse(e));

function readUser(): MemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    return raw.flatMap((e) => {
      const r = MemoryEntrySchema.safeParse(e);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

export const localMemory = {
  all(): MemoryEntry[] {
    return [...SEED, ...readUser()];
  },
  save(entry: MemoryEntry): void {
    const list = readUser().filter((e) => e.id !== entry.id);
    list.push(entry);
    localStorage.setItem(KEY, JSON.stringify(list)); // throws on quota errors → caller shows error (Req 15.8)
  },
  /** "Reset demo": remove user entries, keep samples (Req 15.9). */
  reset(): void {
    localStorage.removeItem(KEY);
  },
};
