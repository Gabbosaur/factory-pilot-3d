import { describe, expect, it } from 'vitest';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { initProduction, stepProduction } from '@/modules/monitoring/production/production';
import { buildPlant, plantModel } from '@/modules/plant/plant';
import { buildContext } from '@/modules/copilot/context';
import type { FactoryConfig, Sample } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error('invalid');
  return r.config;
}

describe('Copilot context', () => {
  const factory = buildPlant('p', 'Genova plant', [load(bottling), load(twin)]);
  const plant = plantModel(factory);
  const productions = Object.fromEntries(
    plant.lines.map((l) => {
      let p = initProduction();
      for (let i = 0; i < 120; i++) p = stepProduction(p, l.config, { lineRunning: l.id === 'L1', speed: 1, values: {} });
      return [l.id, p];
    }),
  );
  const history: Record<string, Record<string, Sample[]>> = {
    P1: { vib: Array.from({ length: 60 }, (_, i) => ({ machineId: 'P1', sensorId: 'vib', value: 1.3 + i * 0.045, ts: i })) },
  };
  const input = {
    factory,
    plant,
    tick: 120,
    statuses: { P1: 'giallo' as const },
    speed: {},
    lines: {
      L1: { running: true, trippedBy: null, stopSec: 0 },
      L2: { running: false, trippedBy: { machineId: 'L2-P1', sensorId: 'vib', value: 4.6, threshold: 4.5 }, stopSec: 120 },
    },
    productions,
    stops: [{ lineId: 'L2', machineId: 'L2-P1', sensorId: 'vib', startTick: 0, endTick: null }],
    bypassed: {},
    holds: [],
    incidents: {},
    history,
  };

  it('summarises the plant compactly with the figures an engineer needs', () => {
    const ctx = buildContext(input) as { lines: Array<{ id: string; state: string; oeePct: number }>; downtimePareto: Array<{ seconds: number }> };
    const json = JSON.stringify(ctx);
    expect(json.length).toBeLessThan(40_000);
    expect(ctx.lines.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(ctx.lines[1]!.state).toMatch(/protective trip on L2-P1/);
    expect(ctx.lines[1]!.oeePct).toBe(0);
    expect(ctx.downtimePareto[0]!.seconds).toBe(120);
  });

  it('adds sensors with zone, trend and time to trip for a machine', () => {
    const ctx = buildContext(input, 'P1') as { machine: { sensors: Array<{ id: string; zone: string; trendPerMin: number; minutesToTrip: number | null }> } };
    const vib = ctx.machine.sensors.find((s) => s.id === 'vib')!;
    expect(vib.zone).toBe('warning');
    expect(vib.trendPerMin).toBeCloseTo(2.7, 2);
    expect(vib.minutesToTrip).not.toBeNull();
  });
});
