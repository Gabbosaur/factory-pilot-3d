import { describe, expect, it } from 'vitest';
import { causeOptions } from '@/modules/incidents/causes';
import type { MemoryEntry } from '@/shared/types';

const mem = (realCause: string): MemoryEntry => ({
  id: realCause,
  machineId: 'P1',
  machineType: 'centrifugal_pump',
  sensorIds: ['vib'],
  realCause,
  fix: 'fix',
  durationMin: 60,
  closedAt: '2026-10-01T10:00:00Z',
  isSample: true,
});

describe('Root-cause options', () => {
  it('lists the AI cause first, then memory, then typical causes for the type, without duplicates', () => {
    const opts = causeOptions('centrifugal_pump', 'Worn bearing in the feed pump', [mem('Coupling misalignment'), mem('Worn bearing in the feed pump')]);
    expect(opts[0]).toEqual({ value: 'Worn bearing in the feed pump', label: 'Worn bearing in the feed pump', source: 'ai' });
    expect(opts[1]?.source).toBe('memory');
    expect(opts.filter((o) => o.value.toLowerCase() === 'coupling misalignment')).toHaveLength(1);
    expect(opts.some((o) => o.source === 'manual' && /Cavitation/.test(o.value))).toBe(true);
  });

  it('works without an AI diagnosis or a known machine type', () => {
    expect(causeOptions('labeller', null, [])).toEqual([]);
    expect(causeOptions('conveyor', null, []).every((o) => o.source === 'manual')).toBe(true);
  });
});
