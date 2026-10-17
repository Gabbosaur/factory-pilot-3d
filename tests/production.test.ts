import { describe, expect, it } from 'vitest';
import bottling from '@/data/factories/bottling-line.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { initProduction, kpis, nominalPerMin, REDUCED_SPEED, stepProduction, type ProductionState } from '@/modules/monitoring/production/production';
import type { FactoryConfig } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error('invalid config');
  return r.config;
}

const c = load(bottling);
const run = (sec: number, input: Parameters<typeof stepProduction>[2], from: ProductionState = initProduction()) => {
  let p = from;
  for (let i = 0; i < sec; i++) p = stepProduction(p, c, input);
  return p;
};

describe('Production counters', () => {
  it('runs at the nominal rate of the line with no rejects', () => {
    expect(nominalPerMin(c)).toBe(100);
    const p = run(3600, { lineRunning: true, speed: 1, values: {} });
    const k = kpis(p, c);
    expect(Math.round(k.good)).toBe(6000);
    expect(Math.round(k.throughputPerHour)).toBe(6000);
    expect(k.oee).toBeCloseTo(1, 6);
  });

  it('counts rejects per station from the reject sensors and lowers quality', () => {
    const p = run(600, { lineRunning: true, speed: 1, values: { 'F1|fill_rejects': 2, 'C1|rejects': 1 } });
    const k = kpis(p, c);
    expect(p.rejects.F1).toBeCloseTo(1000 * 0.02, 6);
    expect(p.rejects.C1).toBeCloseTo(1000 * 0.01, 6);
    expect(k.quality).toBeCloseTo(0.97, 6);
  });

  it('a stopped line produces nothing and lowers availability; reduced speed lowers performance', () => {
    const half = run(300, { lineRunning: true, speed: 1, values: {} });
    const stopped = run(300, { lineRunning: false, speed: 1, values: {} }, half);
    let k = kpis(stopped, c);
    expect(stopped.good).toBeCloseTo(half.good, 6);
    expect(k.availability).toBeCloseTo(0.5, 6);
    expect(k.throughputPerHour).toBe(0);
    const slow = run(600, { lineRunning: true, speed: REDUCED_SPEED, values: {} });
    k = kpis(slow, c);
    expect(k.performance).toBeCloseTo(REDUCED_SPEED, 6);
  });
});
