import { describe, expect, it } from 'vitest';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';
import juice from '@/data/factories/juice-line.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { baseId, buildPlant, capacityFactor, plantModel, siblingsOf } from '@/modules/plant/plant';
import type { FactoryConfig } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.config;
}

describe('Plant model', () => {
  const plant = buildPlant('plant', 'Demo plant', [load(bottling), load(twin)]);

  it('merges lines into one valid config with prefixed, consistent ids', () => {
    expect(parseConfigValue(plant).ok).toBe(true);
    const ids = plant.machines.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('P1');
    expect(ids).toContain('L2-F2');
    for (const m of plant.machines) for (const d of [...m.upstream, ...m.downstream]) expect(ids).toContain(d);
    expect(plant.faults.find((f) => f.id === 'l2-p1-bearing')?.machineId).toBe('L2-P1');
    expect(baseId('L2-P1')).toBe('P1');
  });

  it('derives lines and process clusters in flow order', () => {
    const m = plantModel(plant);
    expect(m.lines.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(m.lines[0]!.clusters.map((c) => c.id)).toEqual(['feed', 'filling', 'eol']);
    expect(m.lines[1]!.clusters.find((c) => c.id === 'filling')!.machineIds.sort()).toEqual(['L2-C1', 'L2-F1', 'L2-F2']);
    expect(m.lines[1]!.config.faults.every((f) => f.machineId.startsWith('L2-'))).toBe(true);
    expect(m.lineOf['L2-K1']).toBe('L2');
  });

  it('the juice line builds a valid single-line plant with its own rate', () => {
    const imperia = buildPlant('imperia', 'Imperia plant', [load(juice)]);
    expect(parseConfigValue(imperia).ok).toBe(true);
    const m = plantModel(imperia);
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0]!.config.machines.every((x) => x.partsPerMin === 67)).toBe(true);
  });

  it('finds the redundant twin filler and the capacity left when one is bypassed', () => {
    expect(siblingsOf(plant, 'L2-F1')).toEqual(['L2-F2']);
    expect(siblingsOf(plant, 'F1')).toEqual([]); // line 1 has a single filler
    expect(siblingsOf(plant, 'L2-C1')).toEqual([]);
    const l2 = plantModel(plant).lines[1]!.config;
    expect(capacityFactor(l2, new Set())).toBe(1);
    expect(capacityFactor(l2, new Set(['L2-F1']))).toBeCloseTo(0.5, 9);
  });

  it('a single-line config without hierarchy fields is one line', () => {
    const m = plantModel(load(bottling));
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0]!.machineIds).toEqual(['P1', 'F1', 'C1', 'K1']);
  });
});
