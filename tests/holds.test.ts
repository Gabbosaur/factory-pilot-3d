import { describe, expect, it } from 'vitest';
import { HOLD_CLEAR_SEC, isQualitySensor, stepHolds, type QualityHold } from '@/modules/quality/holds';

const sig = { machineId: 'F1', sensorId: 'fill_level' };

describe('Quality holds', () => {
  it('recognises product quality sensors', () => {
    expect(['fill_level', 'fill_rejects', 'flow_var', 'torque', 'rejects'].every(isQualitySensor)).toBe(true);
    expect(['vib', 'bearing_temp', 'motor_temp', 'current'].some(isQualitySensor)).toBe(false);
  });

  it('opens on a quality signal, counts good bottles while it lasts, quarantines after the signal clears', () => {
    let holds: QualityHold[] = [];
    let opened: QualityHold | null = null;
    for (let t = 0; t < 40; t++) {
      const r = stepHolds(holds, { lineId: 'L1', tick: t, lineRunning: true, goodNow: 1.5, signal: t < 20 ? sig : null });
      holds = r.holds;
      if (r.opened) opened = r.opened;
    }
    expect(opened?.id).toBe('QH-L1-001');
    expect(holds).toHaveLength(1);
    const h = holds[0]!;
    expect(h.status).toBe('quarantined');
    expect(h.endTick).toBe(19 + HOLD_CLEAR_SEC + 1);
    expect(h.suspect).toBeCloseTo(1.5 * (h.endTick! + 1), 6);
  });

  it('a line stop closes the window; other lines are independent; a new signal opens a new lot', () => {
    let { holds } = stepHolds([], { lineId: 'L2', tick: 0, lineRunning: true, goodNow: 2, signal: sig });
    holds = stepHolds(holds, { lineId: 'L1', tick: 1, lineRunning: true, goodNow: 2, signal: null }).holds;
    expect(holds[0]!.status).toBe('collecting');
    holds = stepHolds(holds, { lineId: 'L2', tick: 1, lineRunning: false, goodNow: 0, signal: null }).holds;
    expect(holds[0]!.status).toBe('quarantined');
    const r = stepHolds(holds, { lineId: 'L2', tick: 50, lineRunning: true, goodNow: 2, signal: sig });
    expect(r.opened?.id).toBe('QH-L2-002');
  });
});
