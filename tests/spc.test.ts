import { describe, expect, it } from 'vitest';
import { condition, controlLimits, cpk, outOfSpecPct, reliability, spcSignal } from '@/modules/monitoring/quality/spc';
import type { MemoryEntry, SensorConfig } from '@/shared/types';

const vib: SensorConfig = { id: 'vib', name: 'Vibration', unit: 'mm/s', nominal: [1.1, 1.5], warn: 1.8, crit: 4.5, noise: 0.05 };
const fill: SensorConfig = { id: 'fill_level', name: 'Fill volume', unit: 'ml', nominal: [499.2, 500.8], warn: 502, crit: 504, noise: 0.4, spec: { lsl: 497, usl: 503 } };

describe('SPC and process capability', () => {
  it('derives control limits from the sensor configuration', () => {
    const l = controlLimits(fill);
    expect(l.center).toBeCloseTo(500, 9);
    expect(l.sigma).toBeCloseTo(0.4 / Math.sqrt(3), 9);
  });

  it('Cpk only on product characteristics, against the declared specification', () => {
    const stable = Array.from({ length: 60 }, (_, i) => 500 + 0.3 * Math.sin(i * 1.7));
    expect(cpk(stable, fill)!).toBeGreaterThan(1.33);
    expect(outOfSpecPct(stable, fill)).toBe(0);
    // Under-filling drift (worn valve): capability collapses and part of the window is out of spec.
    const drift = Array.from({ length: 60 }, (_, i) => 500 - i * 0.08);
    expect(cpk(drift, fill)!).toBeLessThan(1);
    expect(outOfSpecPct(drift, fill)!).toBeGreaterThan(0);
    // Machine condition signals have no specification: no Cpk.
    expect(cpk(stable.map(() => 1.3), vib)).toBeNull();
  });

  it('control chart rules: beyond limits and run of 9', () => {
    const stable = Array.from({ length: 60 }, (_, i) => 1.3 + 0.03 * Math.sin(i * 1.7));
    expect(spcSignal(stable, controlLimits(vib))).toBeNull();
    const drift = Array.from({ length: 60 }, (_, i) => 1.3 + i * 0.008);
    expect(spcSignal(drift, controlLimits(vib))?.rule).toBe('beyond_limits');
    const run = [...stable.slice(0, 50), 1.32, 1.33, 1.31, 1.34, 1.32, 1.33, 1.31, 1.32, 1.34];
    expect(spcSignal(run, controlLimits(vib))?.rule).toBe('run_of_9');
  });

  it('condition monitoring: zone, trend per minute and time to the trip limit', () => {
    const rising = Array.from({ length: 80 }, (_, i) => 1.3 + i * 0.045); // +2.7 mm/s per minute, ends at 4.86
    const c = condition(rising, vib)!;
    expect(c.zone).toBe('trip');
    const early = condition(rising.slice(0, 10), vib)!;
    expect(early.zone).toBe('normal');
    expect(early.slopePerMin).toBeCloseTo(2.7, 6);
    expect(early.minutesToTrip!).toBeCloseTo((4.5 - rising[9]!) / 2.7, 6);
    expect(condition(Array.from({ length: 30 }, () => 1.3), vib)!.minutesToTrip).toBeNull();
  });

  it('MTBF and MTTR from closed interventions', () => {
    const e = (d: string, min: number): MemoryEntry => ({ id: d, machineId: 'P1', machineType: 'pump', sensorIds: [], realCause: 'x', fix: 'y', durationMin: min, closedAt: d, isSample: true });
    const r = reliability([e('2026-09-01T00:00:00Z', 60), e('2026-09-21T00:00:00Z', 30)], Date.parse('2026-10-01T00:00:00Z'));
    expect(r).toEqual({ failures: 2, mtbfDays: 15, mttrMin: 45 });
  });
});
