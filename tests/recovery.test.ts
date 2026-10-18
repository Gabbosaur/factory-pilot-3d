import { describe, expect, it } from 'vitest';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { initProduction, stepProduction } from '@/modules/monitoring/production/production';
import { buildPlant, plantModel } from '@/modules/plant/plant';
import { getSituation, mttr, simulate, type RecoveryInput } from '@/modules/agent/recovery';
import type { FactoryConfig } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error('invalid');
  return r.config;
}

const factory = buildPlant('p', 'Plant', [load(bottling), load(twin)]);
const plant = plantModel(factory);
const run = (cfg: FactoryConfig, sec: number) => {
  let p = initProduction();
  for (let i = 0; i < sec; i++) p = stepProduction(p, cfg, { lineRunning: true, speed: 1, values: {} });
  return p;
};
// 60 minutes into the shift; L2-F1 bypassed to L2-F2 (L2 at 50 %).
const input: RecoveryInput = {
  plant,
  productions: { L1: run(plant.lines[0]!.config, 3600), L2: run(plant.lines[1]!.config, 3600) },
  lines: { L1: { running: true, trippedBy: null }, L2: { running: true, trippedBy: null } },
  bypassed: { 'L2-F1': { lineId: 'L2', sibling: 'L2-F2' } },
  speed: {},
  statuses: {},
  openIncidentMachines: ['L2-F1'],
  memory: [],
};

describe('Recovery planner tools', () => {
  it('projects the gap to the shift target when a line runs at 50 %', () => {
    const s = getSituation(input);
    const l2 = s.lines.find((l) => l.line === 'L2')!;
    expect(l2.state).toBe('running at 50%');
    expect(l2.remainingMin).toBe(420);
    expect(l2.gapBottles).toBe(Math.round(160 * 420 * 0.5)); // half the remaining output is missing
    expect(l2.faultyMachines[0]).toMatchObject({ machineId: 'L2-F1', mttrMin: 40 });
    expect(s.lines.find((l) => l.line === 'L1')!.spareCapacityForBoostPerMin).toBe(10);
  });

  it('repairing a bypassed filler now recovers most of the gap; boosting the other line helps less', () => {
    const repair = simulate(input, { type: 'repair_now', line: 'L2', machine: 'L2-F1' }) as { extraBottles: number; netEur: number };
    // the twin keeps 50 % during the 40 min repair, then 100 % for 380 min
    expect(repair.extraBottles).toBe(Math.round(160 * 0.5 * 40 + 160 * 380 - 160 * 0.5 * 420));
    const boost = simulate(input, { type: 'boost_other_line', line: 'L1', minutes: 420 }) as { extraBottles: number };
    expect(boost.extraBottles).toBe(Math.round(100 * 0.1 * 420));
    expect(repair.extraBottles).toBeGreaterThan(boost.extraBottles);
    expect(simulate(input, { type: 'boost_other_line', line: 'L2', minutes: 60 })).toHaveProperty('error');
    expect(simulate(input, { type: 'repair_now', line: 'L2', machine: 'L2-C1' })).toHaveProperty('error');
  });

  it('MTTR comes from the factory memory when available', () => {
    expect(mttr('P1', 'centrifugal_pump', [])).toBe(75);
    expect(mttr('P1', 'centrifugal_pump', [{ id: 'a', machineId: 'P1', machineType: 'centrifugal_pump', sensorIds: [], realCause: 'x', fix: 'y', durationMin: 55, closedAt: '2026-09-01T00:00:00Z', isSample: true }])).toBe(55);
  });
});
