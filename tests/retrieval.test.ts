import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';
import seed from '@/data/memory-seed.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { buildPlant } from '@/modules/plant/plant';
import { machinesFor, retrieve, verifySource } from '@/modules/copilot/retrieval';
import type { FactoryConfig, MemoryEntry } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error('invalid');
  return r.config;
}

const factory = buildPlant('p', 'Plant', [load(bottling), load(twin)]);
const manuals = Object.fromEntries(['pump-p1', 'filler-f1', 'capper-c1', 'conveyor-k1'].map((m) => [m, readFileSync(`data/manuals/${m}.md`, 'utf8')]));
const memory = seed as MemoryEntry[];

describe('Copilot retrieval (manuals + factory memory)', () => {
  it('finds the machines a question is about', () => {
    expect(machinesFor('How do I replace the bearing of L2-P1?', factory, [])).toEqual(['L2-P1']);
    expect(machinesFor('Why is the plant slow?', factory, ['L2-F1'])).toEqual(['L2-F1']);
    expect(machinesFor('anything', factory, [], 'K1')).toEqual(['K1']);
  });

  it('retrieves the bearing replacement page and spare parts from the pump manual, plus past interventions', () => {
    const r = retrieve('How do I replace the bearing, which spare parts do I need?', factory, manuals, memory, [], 'P1');
    const pages = r.manualPages.map((p) => p.page);
    expect(pages).toContain(7); // Bearing replacement
    expect(pages).toContain(8); // Spare parts
    expect(r.manualPages.length).toBeLessThanOrEqual(3);
    expect(r.interventions[0]?.machineId).toBe('P1');
  });

  it('verifies cited sources: existing pages and interventions only', () => {
    expect(verifySource({ type: 'manual', ref: 'P1', page: 7 }, factory, manuals, memory)).toBe(true);
    expect(verifySource({ type: 'manual', ref: 'L2-P1', page: 7 }, factory, manuals, memory)).toBe(true);
    expect(verifySource({ type: 'manual', ref: 'P1', page: 42 }, factory, manuals, memory)).toBe(false);
    expect(verifySource({ type: 'memory', ref: memory[0]!.id }, factory, manuals, memory)).toBe(true);
    expect(verifySource({ type: 'memory', ref: 'made-up' }, factory, manuals, memory)).toBe(false);
  });
});
