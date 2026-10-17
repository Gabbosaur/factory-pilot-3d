import { describe, expect, it } from 'vitest';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { initProduction, stepProduction } from '@/modules/monitoring/production/production';
import { buildPlant, plantModel } from '@/modules/plant/plant';
import { bottleneck, clusterMetrics, downtimePareto, plantKpis } from '@/modules/plant/metrics';
import type { FactoryConfig } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error('invalid');
  return r.config;
}

const config = buildPlant('p', 'Plant', [load(bottling), load(twin)]);
const plant = plantModel(config);

describe('Plant metrics', () => {
  it('plant OEE is output-weighted: a stopped big line weighs more than a stopped small one', () => {
    const [l1, l2] = plant.lines;
    const run = (cfg: FactoryConfig, running: boolean, n = 600) => {
      let p = initProduction();
      for (let i = 0; i < n; i++) p = stepProduction(p, cfg, { lineRunning: running, speed: 1, values: {} });
      return p;
    };
    // L1: 6,000/h, L2: 9,600/h. Stopping L2 loses more output than stopping L1.
    const l2Stopped = plantKpis(plant, { [l1!.id]: run(l1!.config, true), [l2!.id]: run(l2!.config, false) });
    const l1Stopped = plantKpis(plant, { [l1!.id]: run(l1!.config, false), [l2!.id]: run(l2!.config, true) });
    expect(l2Stopped.oee).toBeCloseTo(6000 / 15600, 3);
    expect(l1Stopped.oee).toBeCloseTo(9600 / 15600, 3);
    expect(l2Stopped.availability).toBeCloseTo(0.5, 6);
  });

  it('finds the bottleneck cluster when a machine runs slower', () => {
    const line = plant.lines[0]!;
    const balanced = clusterMetrics(line, initProduction(), {}, {}, true);
    expect(bottleneck(balanced)).toBeNull();
    const slowed = clusterMetrics(line, initProduction(), {}, { K1: 0.65 }, true);
    expect(bottleneck(slowed)?.cluster.id).toBe('eol');
  });

  it('cluster capacity: parallel machines add up, series steps take the slowest, bypassed machines count zero', () => {
    const filling = (lineIdx: number, bypassed = new Set<string>()) =>
      clusterMetrics(plant.lines[lineIdx]!, initProduction(), {}, {}, true, bypassed).find((c) => c.cluster.id === 'filling')!;
    expect(filling(0).capacityPerHour).toBe(6000); // F1 → C1 in series
    expect(filling(1).capacityPerHour).toBe(9600); // F1 ∥ F2 (4,800 each) → C1 9,600
    expect(filling(1, new Set(['L2-F1'])).capacityPerHour).toBe(4800);
    expect(filling(1, new Set(['L2-F1'])).nominalPerHour).toBe(9600);
  });

  it('downtime Pareto sums stops by cause, counting ongoing ones', () => {
    const p = downtimePareto(
      [
        { machineId: 'P1', sensorId: 'vib', startTick: 10, endTick: 70 },
        { machineId: 'K1', sensorId: 'motor_temp', startTick: 100, endTick: 120 },
        { machineId: 'P1', sensorId: 'vib', startTick: 200, endTick: null },
      ],
      230,
      config,
    );
    expect(p[0]).toMatchObject({ key: 'P1|vib', value: 90 });
    expect(p[1]!.cumulativePct).toBeCloseTo(100, 6);
  });
});
